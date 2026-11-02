import {
  answerReview,
  clearReviewAnswer,
  nextStudyEquipmentId,
  planDesignReview,
  setReviewCheckOff,
  setStudyEquipment,
} from "@gap/engine";
import { REVIEW_RESPONSES, REVIEW_RESPONSE_LABEL, type ReviewResponse, type SamplingPlan, type StudyEquipment, type StudyEquipmentItem } from "@gap/process-model";
import { designReviewLine, type ReviewItem } from "@gap/sampling";
import { samplingSuggestions } from "@gap/content";
import { useId, useMemo, useState } from "react";
import { dateTime } from "../lib";
import { useContent, useStore } from "../store";
import type { Run } from "./SamplingFlow";

/**
 * The "Design review" tab: questions the plan raises about how samples are taken and placed. They are questions, never verdicts; the
 * team answers each one, and an answer is kept with who gave it and when. If the plan changes in the part a question reads, the answer is
 * marked "look again" instead of being silently trusted.
 */

/** The line shown on the Overview tab, from the same view as the tab. */
export function useDesignReview(plan: SamplingPlan) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  return useMemo(() => planDesignReview(content, project, plan, samplingSuggestions), [content, project, plan]);
}

export function DesignReviewLine({ plan, onOpen }: { plan: SamplingPlan; onOpen: () => void }) {
  const view = useDesignReview(plan);
  return (
    <p data-testid="review-line">
      {designReviewLine(view)}.{" "}
      <button type="button" className="link-btn" onClick={onOpen} data-testid="review-line-open">
        Open the Design review tab
      </button>
    </p>
  );
}

const STATE_TEXT = { unanswered: "Unanswered", answered: "Answered", look_again: "Look again" } as const;

export function SamplingReview({ plan, run, onOpenPoint }: { plan: SamplingPlan; run: Run; onOpenPoint: (id: string) => void }) {
  const view = useDesignReview(plan);
  const onOpenStep = () => {
    const el = document.getElementById("sp-steps-h");
    if (!el) return;
    el.setAttribute("tabindex", "-1");
    el.scrollIntoView({ block: "start" });
    el.focus({ preventScroll: true });
  };
  return (
    <section className="card stack" aria-labelledby="sp-review" data-testid="design-review">
      <h2 id="sp-review">Design review</h2>
      <p className="small muted">
        Questions about how the samples are taken and where they sit. They ask; they do not judge. Answer each one for your plan, or switch a check off if it does not apply to this plan. Nothing here decides anything for you.
      </p>
      <p data-testid="review-summary" role="status">
        {designReviewLine(view)}.
      </p>
      {view.groups.map((g) => (
        <div key={g.group} className="stack" data-testid={`review-group-${g.group}`}>
          <h3 id={`sp-review-${g.group}`}>{g.title}</h3>
          {g.group === "A" && <StudyEquipmentCard plan={plan} run={run} />}
          {g.items.length === 0 ? (
            <p className="small muted">No questions in this group for the plan as it stands.</p>
          ) : (
            [...g.items]
              .sort((a, b) => Number(b.finding.checkId === "A5") - Number(a.finding.checkId === "A5"))
              .map((it) => <ReviewCard key={it.finding.key} plan={plan} item={it} run={run} onOpenPoint={onOpenPoint} onOpenStep={onOpenStep} />)
          )}
        </div>
      ))}
      {view.off.length > 0 && (
        <details data-testid="review-off">
          <summary>Checks switched off for this plan ({view.off.length})</summary>
          <ul className="plain-list stack">
            {view.off.map((o) => (
              <li key={o.checkId} className="row wrap" data-testid={`review-off-${o.checkId}`}>
                <span>
                  <strong>{o.checkId}</strong>: {o.title}. {o.reason ? `Reason: ${o.reason}` : "No reason given."}
                </span>
                <button type="button" className="btn" onClick={() => run((p, actor) => setReviewCheckOff(p, plan.id, o.checkId, false, undefined, actor), `Check ${o.checkId} switched on`)} data-testid={`review-on-${o.checkId}`}>
                  Switch on
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ReviewCard({ plan, item, run, onOpenPoint, onOpenStep }: { plan: SamplingPlan; item: ReviewItem; run: Run; onOpenPoint: (id: string) => void; onOpenStep: () => void }) {
  const f = item.finding;
  const [reason, setReason] = useState(item.answer?.reason ?? "");
  const [offOpen, setOffOpen] = useState(false);
  const [offReason, setOffReason] = useState("");
  const reasonId = useId();
  const answer = (response: ReviewResponse) =>
    run((p, actor) => answerReview(p, plan.id, f.key, { response, ...(reason.trim() ? { reason } : {}), factsFingerprint: f.factsFingerprint }, actor), `${f.checkId} answered`);
  const points = f.subjects.filter((s) => s.startsWith("SP-"));
  const hasStep = f.subjects.some((s) => s.startsWith("ST-"));
  return (
    <article className={`review-card review-${item.state}`} aria-labelledby={`rc-${f.key}`} data-testid={`review-card-${f.key}`} data-state={item.state}>
      <header className="row wrap">
        <h4 id={`rc-${f.key}`}>
          {f.checkId}: {f.title}
        </h4>
        <span className="tag" data-testid={`review-state-${f.key}`}>
          {STATE_TEXT[item.state]}
        </span>
      </header>
      <p className="small">
        <strong>The plan says:</strong> {f.states}
      </p>
      <p className="small muted">
        <strong>Why it matters:</strong> {f.why}
      </p>
      <p>
        <strong>{f.question}</strong>
      </p>
      {(points.length > 0 || hasStep) && (
        <p className="small row wrap">
          {points.map((id) => (
            <button key={id} type="button" className="link-btn" onClick={() => onOpenPoint(id)}>
              Open sample {id}
            </button>
          ))}
          {hasStep && (
            <button type="button" className="link-btn" onClick={onOpenStep}>
              Open the process steps
            </button>
          )}
        </p>
      )}
      {item.state === "look_again" && (
        <p className="notice" role="note" data-testid={`review-lookagain-${f.key}`}>
          Look again: the plan changed in the part this question reads since it was answered ({item.answer ? `${REVIEW_RESPONSE_LABEL[item.answer.response]}, ${item.answer.by ?? "unknown"}, ${dateTime(item.answer.at)}` : "earlier"}). Please confirm the answer still holds.
        </p>
      )}
      {item.state === "answered" && item.answer && (
        <p className="small" data-testid={`review-by-${f.key}`}>
          Answered: {REVIEW_RESPONSE_LABEL[item.answer.response]}
          {item.answer.by ? `, by ${item.answer.by}` : ""}, {dateTime(item.answer.at)}.
        </p>
      )}
      <div className="field">
        <label htmlFor={reasonId}>Reason or note (optional)</label>
        <input
          id={reasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => {
            if (item.answer && reason.trim() !== (item.answer.reason ?? "") && item.state === "answered") answer(item.answer.response);
          }}
          data-testid={`review-reason-${f.key}`}
        />
      </div>
      <div className="row wrap" role="group" aria-label={`Answer for ${f.checkId}`}>
        {REVIEW_RESPONSES.map((r) => (
          <button key={r} type="button" className={item.answer?.response === r && item.state === "answered" ? "btn primary" : "btn"} aria-pressed={item.answer?.response === r && item.state === "answered"} onClick={() => answer(r)} data-testid={`review-${r}-${f.key}`}>
            {REVIEW_RESPONSE_LABEL[r]}
          </button>
        ))}
        {item.answer && (
          <button type="button" className="link-btn" onClick={() => run((p, actor) => clearReviewAnswer(p, plan.id, f.key, actor), `${f.checkId} answer cleared`)} data-testid={`review-clear-${f.key}`}>
            Clear the answer
          </button>
        )}
      </div>
      {!offOpen ? (
        <p className="small">
          <button type="button" className="link-btn" onClick={() => setOffOpen(true)} data-testid={`review-off-open-${f.key}`}>
            Switch this check off for this plan
          </button>
        </p>
      ) : (
        <div className="stack small">
          <label className="field">
            <span>Why switch {f.checkId} off? (optional)</span>
            <input value={offReason} onChange={(e) => setOffReason(e.target.value)} data-testid={`review-off-reason-${f.key}`} />
          </label>
          <div className="row wrap">
            <button type="button" className="btn" onClick={() => run((p, actor) => setReviewCheckOff(p, plan.id, f.checkId, true, offReason, actor), `Check ${f.checkId} switched off`)} data-testid={`review-off-confirm-${f.key}`}>
              Switch off {f.checkId}
            </button>
            <button type="button" className="btn" onClick={() => setOffOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

// ------------------------------------------------------------------ A5: equipment used only for the study

type Tri = "" | "yes" | "no";
const tri = (v: boolean | undefined): Tri => (v === undefined ? "" : v ? "yes" : "no");
const unTri = (v: string): boolean | undefined => (v === "yes" ? true : v === "no" ? false : undefined);

function TriSelect({ label, value, onChange, testId }: { label: string; value: boolean | undefined; onChange: (v: boolean | undefined) => void; testId: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={tri(value)} onChange={(e) => onChange(unTri(e.target.value))} data-testid={testId}>
        <option value="">Not stated</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

function StudyEquipmentCard({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const eq = plan.designReview?.studyEquipment;
  const save = (next: StudyEquipment | undefined, status: string) => run((p, actor) => setStudyEquipment(p, plan.id, next, actor), status);
  const items = eq?.items ?? [];
  const name = useId();
  return (
    <div className="review-card" data-testid="review-equipment">
      <h4>A5: Equipment used only for the study</h4>
      <fieldset className="fs stack">
        <legend>Is any equipment used only to take these samples, and not in the commercial process?</legend>
        <div className="check-grid">
          {([["", "Not stated"], ["yes", "Yes"], ["no", "No"]] as const).map(([v, label]) => (
            <label key={v} className="check">
              <input
                type="radio"
                name={name}
                checked={tri(eq?.used) === v}
                onChange={() => {
                  const used = unTri(v);
                  save(used === undefined && items.length === 0 ? undefined : { ...(used === undefined ? {} : { used }), items }, "Study equipment saved");
                }}
                data-testid={`review-eq-used-${v || "unset"}`}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {eq?.used === true && (
        <div className="stack">
          {items.map((it) => (
            <EquipmentItem key={it.id} plan={plan} item={it} onChange={(n) => save({ ...eq, items: items.map((x) => (x.id === it.id ? n : x)) }, `${it.id} saved`)} onRemove={() => save({ ...eq, items: items.filter((x) => x.id !== it.id) }, `${it.id} removed`)} />
          ))}
          <div>
            <button type="button" className="btn" onClick={() => save({ ...eq, items: [...items, { id: nextStudyEquipmentId(items), what: "New item" }] }, "Equipment item added")} data-testid="review-eq-add">
              Add an item
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EquipmentItem({ plan, item, onChange, onRemove }: { plan: SamplingPlan; item: StudyEquipmentItem; onChange: (n: StudyEquipmentItem) => void; onRemove: () => void }) {
  const [what, setWhat] = useState(item.what);
  const [pts, setPts] = useState((item.pointIds ?? []).join(", "));
  const build = (patch: Partial<StudyEquipmentItem>): StudyEquipmentItem => {
    const next: StudyEquipmentItem = { ...item, ...patch };
    for (const k of ["stepId", "pointIds", "inCommercialProcess", "qualified", "removedAfter"] as const) if (next[k] === undefined) delete next[k];
    return next;
  };
  return (
    <fieldset className="fs stack review-eq-item" data-testid={`review-eq-${item.id}`}>
      <legend>{item.id}</legend>
      <label className="field">
        <span>What is it?</span>
        <input value={what} onChange={(e) => setWhat(e.target.value)} onBlur={() => what.trim() && what.trim() !== item.what && onChange(build({ what }))} data-testid={`review-eq-what-${item.id}`} />
      </label>
      <label className="field">
        <span>Process step</span>
        <select value={item.stepId ?? ""} onChange={(e) => onChange(build({ stepId: e.target.value || undefined }))} data-testid={`review-eq-step-${item.id}`}>
          <option value="">Not stated</option>
          {plan.steps.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}: {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Samples taken with it (ids, separated by commas)</span>
        <input
          value={pts}
          onChange={(e) => setPts(e.target.value)}
          onBlur={() => {
            const ids = pts.split(/[\s,;]+/).filter(Boolean);
            if (ids.join(",") !== (item.pointIds ?? []).join(",")) onChange(build({ pointIds: ids.length ? ids : undefined }));
          }}
          data-testid={`review-eq-points-${item.id}`}
        />
      </label>
      <div className="row wrap">
        <TriSelect label="Also in the commercial process?" value={item.inCommercialProcess} onChange={(v) => onChange(build({ inCommercialProcess: v }))} testId={`review-eq-comm-${item.id}`} />
        <TriSelect label="Qualified?" value={item.qualified} onChange={(v) => onChange(build({ qualified: v }))} testId={`review-eq-qual-${item.id}`} />
        <TriSelect label="Removed after sampling?" value={item.removedAfter} onChange={(v) => onChange(build({ removedAfter: v }))} testId={`review-eq-removed-${item.id}`} />
      </div>
      <div>
        <button type="button" className="btn danger" onClick={onRemove}>
          Remove {item.id}
        </button>
      </div>
    </fieldset>
  );
}
