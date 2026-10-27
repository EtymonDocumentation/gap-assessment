import { setReadiness, updatePlanDesign } from "@gap/engine";
import { PPQ_READINESS_ITEMS, READINESS_STATUSES, READINESS_STATUS_LABEL, type SamplingPlan } from "@gap/process-model";
import { useState } from "react";
import type { Run } from "./SamplingFlow";

type Decision = "" | "planned" | "not_planned";

/**
 * PPQ design decisions (bracketing, rework, engineering batch, freeze rule, sampling after PPQ) and the readiness checklist.
 * Every field starts empty: the tool asks the questions and never supplies an answer. An unanswered readiness item prints as
 * "Unknown" in the plan document.
 */
export function DesignCard({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const d = plan.design ?? {};
  const [bracketing, setBracketing] = useState(d.bracketing ?? "");
  const [rework, setRework] = useState(d.rework ?? "");
  const [decision, setDecision] = useState<Decision>(d.engineeringBatch?.decision ?? "");
  const [ebNote, setEbNote] = useState(d.engineeringBatch?.note ?? "");
  const [freezeRule, setFreezeRule] = useState(d.freezeRule ?? "");
  const [postPpq, setPostPpq] = useState(d.postPpq ?? "");

  function save() {
    run(
      (p, actor) =>
        updatePlanDesign(
          p,
          plan.id,
          {
            bracketing,
            rework,
            freezeRule,
            postPpq,
            engineeringBatch: { ...(decision ? { decision } : {}), note: ebNote },
          },
          actor,
        ),
      "PPQ design decisions saved",
    );
  }

  return (
    <section className="card stack" aria-labelledby="sp-design" data-testid="plan-design">
      <h2 id="sp-design">PPQ design and readiness</h2>
      <p className="muted small">Optional. The tool does not suggest an answer to any of these. Whatever you leave empty is shown as not stated (design) or Unknown (readiness) in the plan document.</p>
      <label className="field">
        <span>Bracketing of batch size or other variables, and why</span>
        <textarea rows={2} value={bracketing} onChange={(e) => setBracketing(e.target.value)} data-testid="plan-design-bracketing" />
      </label>
      <label className="field">
        <span>Rework during PPQ (what is allowed, if anything)</span>
        <textarea rows={2} value={rework} onChange={(e) => setRework(e.target.value)} data-testid="plan-design-rework" />
      </label>
      <label className="field">
        <span>Engineering batch before PPQ</span>
        <select value={decision} onChange={(e) => setDecision(e.target.value as Decision)} data-testid="plan-design-eb-decision">
          <option value="">Not decided</option>
          <option value="planned">Planned</option>
          <option value="not_planned">Not planned</option>
        </select>
      </label>
      <label className="field">
        <span>Engineering batch: reason and what it covers</span>
        <textarea rows={2} value={ebNote} onChange={(e) => setEbNote(e.target.value)} data-testid="plan-design-eb-note" />
      </label>
      <label className="field">
        <span>Freeze rule (what may not change between the engineering batch and the PPQ batches)</span>
        <textarea rows={2} value={freezeRule} onChange={(e) => setFreezeRule(e.target.value)} data-testid="plan-design-freeze" />
      </label>
      <label className="field">
        <span>Sampling after PPQ (enhanced sampling until routine monitoring takes over)</span>
        <textarea rows={2} value={postPpq} onChange={(e) => setPostPpq(e.target.value)} data-testid="plan-design-post-ppq" />
      </label>
      <div>
        <button type="button" className="btn primary" onClick={save} data-testid="plan-design-save">
          Save PPQ design decisions
        </button>
      </div>

      <h3 id="sp-readiness">Readiness before PPQ starts</h3>
      <ul className="plain-list stack" aria-labelledby="sp-readiness" data-testid="plan-readiness">
        {PPQ_READINESS_ITEMS.map((item) => (
          <ReadinessRow key={item.key + JSON.stringify(plan.readiness?.find((e) => e.key === item.key) ?? null)} plan={plan} itemKey={item.key} label={item.label} run={run} />
        ))}
      </ul>
    </section>
  );
}

function ReadinessRow({ plan, itemKey, label, run }: { plan: SamplingPlan; itemKey: string; label: string; run: Run }) {
  const cur = plan.readiness?.find((e) => e.key === itemKey);
  const [status, setStatus] = useState<string>(cur?.status ?? "");
  const [note, setNote] = useState(cur?.note ?? "");
  const tid = `plan-readiness-${itemKey}`;

  function save(nextStatus: string, nextNote: string) {
    const s = READINESS_STATUSES.find((x) => x === nextStatus);
    run((p, actor) => setReadiness(p, plan.id, itemKey, { ...(s ? { status: s } : {}), note: nextNote }, actor), `${label}: readiness saved`);
  }

  return (
    <li className="row wrap" data-testid={tid}>
      <label className="field">
        <span>{label}</span>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            save(e.target.value, note);
          }}
          data-testid={`${tid}-status`}
        >
          <option value="">Unknown</option>
          {READINESS_STATUSES.map((s) => (
            <option key={s} value={s}>
              {READINESS_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (cur?.note ?? "") && save(status, note)} data-testid={`${tid}-note`} />
      </label>
    </li>
  );
}
