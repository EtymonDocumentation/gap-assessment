import { addFigureItem, figureTextSuggestions, holdSuggestions, removeFigureItem, setTimeZero, updateFigureItem, updateStep } from "@gap/engine";
import type { PlanHold, PlanStep, PlanSubProcess, PlanTimeTarget, SamplingPlan } from "@gap/process-model";
import { useId, useMemo, useState } from "react";
import { useContent, useStore } from "../store";
import type { Run } from "./SamplingFlow";

/*
 * M10: the optional data behind the PPQ flow figures (step key settings and hours, holds, time targets, sub-processes, time zero).
 *
 * Design notes (the why):
 *  - EVERYTHING HERE IS OPTIONAL AND STARTS EMPTY. Nothing is a required field, nothing raises a warning or an open item: a step
 *    with no hours is drawn as a narrow block and listed under "Hours not given", which is a normal state of a draft plan.
 *  - SHORT FORM FIRST. Same pattern as the points (M7.2): the step list stays short and each step has "More details" for its
 *    figure text, hours and sub-process. Every field has a visible label, so a keyboard or screen-reader user meets the same form.
 *  - SUGGESTIONS ARE OFFERED, NEVER APPLIED. Hold suggestions come from the plan's own hold-time points; step text suggestions
 *    come from established project / TRD parameter values. A person presses a button to copy them into the plan, and after that the
 *    plan's text is its own: editing it here never changes the project or the TRD (nothing is written back).
 *  - The figure itself never decides whether a time is adequate; a target is the person's number with the person's comparator.
 */

const hoursOf = (t: string): number | null | undefined => {
  if (t.trim() === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** "More details" of one process step: key settings for the figure box, duration, sub-process. Saved with its own button. */
export function StepFigureDetails({ plan, step, run, suggestion }: { plan: SamplingPlan; step: PlanStep; run: Run; suggestion?: string[] }) {
  const uid = useId();
  const [text, setText] = useState((step.figureText ?? []).join("\n"));
  const [hours, setHours] = useState(step.durationHours === undefined ? "" : String(step.durationHours));
  const [sub, setSub] = useState(step.subProcess ?? "");
  const [bad, setBad] = useState("");
  const shownSuggestion = suggestion && suggestion.length && suggestion.join("\n") !== text.trim() ? suggestion : undefined;
  const save = () => {
    const h = hoursOf(hours);
    if (h === undefined) return setBad("Hours must be a number, zero or more, or empty.");
    setBad("");
    run((p, actor) => updateStep(p, plan.id, step.id, { figureText: text.split("\n"), durationHours: h, subProcess: sub || null }, actor), `Figure details saved for ${step.label}`);
  };
  return (
    <details data-testid={`step-more-${step.id}`}>
      <summary>More details: figure text, hours, sub-process</summary>
      <div className="stack">
        <label className="field">
          <span>Key settings shown in the figure box (one per line, optional)</span>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} data-testid={`step-text-${step.id}`} aria-describedby={`${uid}-t`} />
          <span id={`${uid}-t`} className="muted small">
            Plain words, for example a temperature or a mixing time. Only what you type is drawn; the project's values are never copied in by themselves.
          </span>
        </label>
        {shownSuggestion && (
          <div className="notice small" data-testid={`step-suggest-${step.id}`}>
            <p>Suggested from the project's established parameter values: {shownSuggestion.join("; ")}</p>
            <button type="button" className="btn small" data-testid={`step-suggest-use-${step.id}`} onClick={() => setText(shownSuggestion.join("\n"))}>
              Use these lines
            </button>
            <span className="muted small"> They are copied into this field for you to edit and save. The project is not changed.</span>
          </div>
        )}
        <div className="row wrap">
          <label className="field">
            <span>Duration in hours (optional)</span>
            <input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} data-testid={`step-hours-${step.id}`} />
          </label>
          <label className="field">
            <span>Belongs to</span>
            <select value={sub} onChange={(e) => setSub(e.target.value)} data-testid={`step-sub-${step.id}`}>
              <option value="">The main process</option>
              {(plan.subProcesses ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label} (sub-process)
                </option>
              ))}
            </select>
          </label>
        </div>
        {bad && (
          <p className="notice" role="alert">
            {bad}
          </p>
        )}
        <div>
          <button type="button" className="btn" data-testid={`step-more-save-${step.id}`} onClick={save}>
            Save details for {step.label}
          </button>
        </div>
      </div>
    </details>
  );
}

/** Step text suggestions for the whole plan (computed once per plan change; read-only). */
export function useFigureTextSuggestions(plan: SamplingPlan): Record<string, string[]> {
  const content = useContent();
  const project = useStore((s) => s.project)!;
  return useMemo(() => {
    try {
      return figureTextSuggestions(content, project, plan);
    } catch {
      return {};
    }
  }, [content, project, plan]);
}

const EDGE_LABEL = { start: "start", end: "end" } as const;

function StepSelect({ plan, value, onChange, label, testId, none }: { plan: SamplingPlan; value: string; onChange: (v: string) => void; label: string; testId?: string; none?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        {none !== undefined && <option value="">{none}</option>}
        {plan.steps.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Num({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </label>
  );
}

/** Holds, time targets, sub-processes and time zero of the flow figure. Collapsed by default: it is optional detail. */
export function FigureDataCard({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const sug = useMemo(() => holdSuggestions(plan), [plan]);
  const hasSteps = plan.steps.length > 0;
  const tz = plan.timeZero;
  return (
    <section className="card stack" aria-labelledby="sp-figdata-h" data-testid="figure-data-card">
      <h2 id="sp-figdata-h">Flow figure details (optional)</h2>
      <p className="muted small">
        Holds, time targets and a separate process such as a buffer preparation, for the PPQ flow figure. All of it is optional. Where a time is not given the figure draws a narrow block and lists it under "Hours not given"; that is not an open item.
      </p>
      {!hasSteps ? (
        <p className="muted" data-testid="figure-data-nosteps">
          Add process steps first; holds and time targets are placed on steps.
        </p>
      ) : (
        <>
          <details data-testid="figure-holds">
            <summary>Holds ({plan.holds?.length ?? 0})</summary>
            <HoldsEditor plan={plan} run={run} suggestions={sug} />
          </details>
          <details data-testid="figure-targets">
            <summary>Time targets ({plan.timeTargets?.length ?? 0})</summary>
            <TargetsEditor plan={plan} run={run} />
          </details>
          <details data-testid="figure-subs">
            <summary>Sub-processes ({plan.subProcesses?.length ?? 0})</summary>
            <SubProcessEditor plan={plan} run={run} />
          </details>
          <details data-testid="figure-zero">
            <summary>Time zero of the time scale</summary>
            <div className="row wrap end-align">
              <StepSelect plan={plan} value={tz?.stepId ?? ""} none="Not chosen (the end of the first step)" label="Time zero is at a step" testId="timezero-step" onChange={(v) => run((p, actor) => setTimeZero(p, plan.id, v ? { stepId: v, edge: tz?.edge ?? "end" } : null, actor), "Time zero saved")} />
              {tz && (
                <label className="field">
                  <span>Edge of that step</span>
                  <select value={tz.edge} data-testid="timezero-edge" onChange={(e) => run((p, actor) => setTimeZero(p, plan.id, { stepId: tz.stepId, edge: e.target.value as "start" | "end" }, actor), "Time zero saved")}>
                    <option value="start">Start</option>
                    <option value="end">End</option>
                  </select>
                </label>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
}

function HoldsEditor({ plan, run, suggestions }: { plan: SamplingPlan; run: Run; suggestions: ReturnType<typeof holdSuggestions> }) {
  const [label, setLabel] = useState("");
  const [after, setAfter] = useState(plan.steps[0]?.id ?? "");
  return (
    <div className="stack">
      {suggestions.length > 0 && (
        <div className="notice small" data-testid="hold-suggestions">
          <p>
            <strong>Suggested from your hold-time samples.</strong> Nothing is added until you press the button.
          </p>
          <ul className="plain-list">
            {suggestions.map((s) => (
              <li key={s.fromPoint}>
                {s.label}
                {s.durationText ? `, ${s.durationText}` : ""}
                {s.condition ? `, ${s.condition}` : ""} (from {s.fromPoint}){" "}
                <button
                  type="button"
                  className="btn small"
                  aria-label={`Add this hold: ${s.label}`}
                  data-testid={`hold-suggest-${s.fromPoint}`}
                  onClick={() =>
                    run(
                      (p, actor) =>
                        addFigureItem(p, plan.id, "holds", { afterStepId: s.afterStepId, label: s.label, ...(s.durationText ? { durationText: s.durationText } : {}), ...(s.durationHours !== undefined ? { durationHours: s.durationHours } : {}), ...(s.condition ? { condition: s.condition } : {}) }, actor).project,
                      "Hold added from a suggestion",
                    )
                  }
                >
                  Add this hold
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(plan.holds ?? []).map((h) => (
        <HoldRow key={`${h.id}-${JSON.stringify(h)}`} plan={plan} hold={h} run={run} />
      ))}
      <form
        className="row wrap end-align"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim() && after && run((p, actor) => addFigureItem(p, plan.id, "holds", { afterStepId: after, label: label.trim() }, actor).project, "Hold added")) setLabel("");
        }}
      >
        <label className="field grow">
          <span>New hold</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Post-thaw hold (fictional)" data-testid="hold-new-label" />
        </label>
        <StepSelect plan={plan} value={after} onChange={setAfter} label="After step" testId="hold-new-after" />
        <button type="submit" className="btn" disabled={!label.trim()} data-testid="hold-new-add">
          Add hold
        </button>
      </form>
    </div>
  );
}

function HoldRow({ plan, hold, run }: { plan: SamplingPlan; hold: PlanHold; run: Run }) {
  const [d, setD] = useState({ label: hold.label, after: hold.afterStepId, text: hold.durationText ?? "", hours: hold.durationHours === undefined ? "" : String(hold.durationHours), cond: hold.condition ?? "" });
  const [bad, setBad] = useState("");
  return (
    <fieldset className="fs stack" data-testid={`hold-${hold.id}`}>
      <legend>
        {hold.id}: {hold.label}
      </legend>
      <div className="row wrap">
        <label className="field grow">
          <span>Name of the hold</span>
          <input value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} data-testid={`hold-label-${hold.id}`} />
        </label>
        <StepSelect plan={plan} value={d.after} onChange={(v) => setD({ ...d, after: v })} label="After step" />
        <label className="field">
          <span>Duration in words (optional)</span>
          <input value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} data-testid={`hold-text-${hold.id}`} />
        </label>
        <Num label="Hours (optional)" value={d.hours} onChange={(v) => setD({ ...d, hours: v })} testId={`hold-hours-${hold.id}`} />
        <label className="field">
          <span>Condition (optional)</span>
          <input value={d.cond} onChange={(e) => setD({ ...d, cond: e.target.value })} />
        </label>
      </div>
      {bad && (
        <p className="notice" role="alert">
          {bad}
        </p>
      )}
      <div className="row wrap">
        <button
          type="button"
          className="btn small"
          aria-label={`Save ${hold.label}`}
          data-testid={`hold-save-${hold.id}`}
          onClick={() => {
            const h = hoursOf(d.hours);
            if (h === undefined || !d.label.trim()) return setBad("Give the hold a name; hours are a number, zero or more, or empty.");
            setBad("");
            run((p, actor) => updateFigureItem(p, plan.id, "holds", hold.id, { label: d.label, afterStepId: d.after, durationText: d.text, durationHours: h ?? undefined, condition: d.cond }, actor), "Hold saved");
          }}
        >
          Save
        </button>
        <button type="button" className="btn small danger" aria-label={`Remove ${hold.label}`} data-testid={`hold-remove-${hold.id}`} onClick={() => run((p, actor) => removeFigureItem(p, plan.id, "holds", hold.id, actor), "Hold removed")}>
          Remove
        </button>
      </div>
    </fieldset>
  );
}

function TargetsEditor({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const first = plan.steps[0]?.id ?? "";
  const last = plan.steps[plan.steps.length - 1]?.id ?? first;
  const [d, setD] = useState({ label: "", from: first, fromEdge: "end" as "start" | "end", to: last, toEdge: "end" as "start" | "end", cmp: ">=" as ">=" | "<=", hours: "" });
  const [bad, setBad] = useState("");
  return (
    <div className="stack">
      {(plan.timeTargets ?? []).map((t) => (
        <TargetRow key={`${t.id}-${JSON.stringify(t)}`} plan={plan} target={t} run={run} />
      ))}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const h = hoursOf(d.hours);
          if (!d.label.trim() || h === undefined || h === null) return setBad("A time target needs a name and a number of hours.");
          setBad("");
          if (run((p, actor) => addFigureItem(p, plan.id, "timeTargets", { label: d.label.trim(), fromStepId: d.from, fromEdge: d.fromEdge, toStepId: d.to, toEdge: d.toEdge, comparator: d.cmp, hours: h }, actor).project, "Time target added")) setD({ ...d, label: "", hours: "" });
        }}
      >
        <label className="field">
          <span>New time target</span>
          <input value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} placeholder="e.g. Bulk-to-filter limit (fictional)" data-testid="target-new-label" />
        </label>
        <TargetFields plan={plan} d={d} setD={setD} idp="target-new" />
        <div>
          <button type="submit" className="btn" data-testid="target-new-add">
            Add time target
          </button>
        </div>
        {bad && (
          <p className="notice" role="alert">
            {bad}
          </p>
        )}
      </form>
    </div>
  );
}

type TargetDraft = { label: string; from: string; fromEdge: "start" | "end"; to: string; toEdge: "start" | "end"; cmp: ">=" | "<="; hours: string };

function TargetFields({ plan, d, setD, idp }: { plan: SamplingPlan; d: TargetDraft; setD: (d: TargetDraft) => void; idp: string }) {
  const edge = (v: "start" | "end", on: (v: "start" | "end") => void, label: string) => (
    <label className="field">
      <span>{label}</span>
      <select value={v} onChange={(e) => on(e.target.value as "start" | "end")}>
        {(["start", "end"] as const).map((x) => (
          <option key={x} value={x}>
            {EDGE_LABEL[x][0]!.toUpperCase() + EDGE_LABEL[x].slice(1)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="row wrap">
      <StepSelect plan={plan} value={d.from} onChange={(v) => setD({ ...d, from: v })} label="From step" testId={`${idp}-from`} />
      {edge(d.fromEdge, (v) => setD({ ...d, fromEdge: v }), "From the")}
      <StepSelect plan={plan} value={d.to} onChange={(v) => setD({ ...d, to: v })} label="To step" testId={`${idp}-to`} />
      {edge(d.toEdge, (v) => setD({ ...d, toEdge: v }), "To the")}
      <label className="field">
        <span>The run is planned to take</span>
        <select value={d.cmp} onChange={(e) => setD({ ...d, cmp: e.target.value as ">=" | "<=" })} data-testid={`${idp}-cmp`}>
          <option value=">=">At least (≥)</option>
          <option value="<=">No more than (≤)</option>
        </select>
      </label>
      <Num label="Hours" value={d.hours} onChange={(v) => setD({ ...d, hours: v })} testId={`${idp}-hours`} />
    </div>
  );
}

function TargetRow({ plan, target, run }: { plan: SamplingPlan; target: PlanTimeTarget; run: Run }) {
  const [d, setD] = useState<TargetDraft>({ label: target.label, from: target.fromStepId, fromEdge: target.fromEdge, to: target.toStepId, toEdge: target.toEdge, cmp: target.comparator, hours: String(target.hours) });
  const [bad, setBad] = useState("");
  return (
    <fieldset className="fs stack" data-testid={`target-${target.id}`}>
      <legend>
        {target.id}: {target.label}
      </legend>
      <label className="field">
        <span>Name</span>
        <input value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} />
      </label>
      <TargetFields plan={plan} d={d} setD={setD} idp={`target-${target.id}`} />
      {bad && (
        <p className="notice" role="alert">
          {bad}
        </p>
      )}
      <div className="row wrap">
        <button
          type="button"
          className="btn small"
          aria-label={`Save ${target.label}`}
          onClick={() => {
            const h = hoursOf(d.hours);
            if (!d.label.trim() || h === undefined || h === null) return setBad("A time target needs a name and a number of hours.");
            setBad("");
            run((p, actor) => updateFigureItem(p, plan.id, "timeTargets", target.id, { label: d.label, fromStepId: d.from, fromEdge: d.fromEdge, toStepId: d.to, toEdge: d.toEdge, comparator: d.cmp, hours: h }, actor), "Time target saved");
          }}
        >
          Save
        </button>
        <button type="button" className="btn small danger" aria-label={`Remove ${target.label}`} data-testid={`target-remove-${target.id}`} onClick={() => run((p, actor) => removeFigureItem(p, plan.id, "timeTargets", target.id, actor), "Time target removed")}>
          Remove
        </button>
      </div>
    </fieldset>
  );
}

function SubProcessEditor({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const [label, setLabel] = useState("");
  return (
    <div className="stack">
      <p className="muted small">A sub-process, such as a buffer preparation, is drawn as its own figure before the main one. Put its steps in it with "More details" on each step.</p>
      {(plan.subProcesses ?? []).map((b) => (
        <SubRow key={`${b.id}-${JSON.stringify(b)}`} plan={plan} sub={b} run={run} />
      ))}
      <form
        className="row wrap end-align"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim() && run((p, actor) => addFigureItem(p, plan.id, "subProcesses", { label: label.trim() }, actor).project, "Sub-process added")) setLabel("");
        }}
      >
        <label className="field grow">
          <span>New sub-process</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Buffer preparation (fictional)" data-testid="sub-new-label" />
        </label>
        <button type="submit" className="btn" disabled={!label.trim()} data-testid="sub-new-add">
          Add sub-process
        </button>
      </form>
    </div>
  );
}

function SubRow({ plan, sub, run }: { plan: SamplingPlan; sub: PlanSubProcess; run: Run }) {
  const [d, setD] = useState({ label: sub.label, feeds: sub.feedsStepId ?? "", cmp: sub.processingTarget?.comparator ?? ("<=" as ">=" | "<="), hours: sub.processingTarget ? String(sub.processingTarget.hours) : "" });
  const [bad, setBad] = useState("");
  // Only main-process steps can be fed.
  const main = { ...plan, steps: plan.steps.filter((s) => !s.subProcess) };
  return (
    <fieldset className="fs stack" data-testid={`sub-${sub.id}`}>
      <legend>
        {sub.id}: {sub.label}
      </legend>
      <div className="row wrap">
        <label className="field grow">
          <span>Name</span>
          <input value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} />
        </label>
        <StepSelect plan={main} value={d.feeds} none="Feeds no step yet" onChange={(v) => setD({ ...d, feeds: v })} label="Feeds the step" testId={`sub-feeds-${sub.id}`} />
        <label className="field">
          <span>Processing time target (optional)</span>
          <select value={d.cmp} onChange={(e) => setD({ ...d, cmp: e.target.value as ">=" | "<=" })}>
            <option value="<=">No more than (≤)</option>
            <option value=">=">At least (≥)</option>
          </select>
        </label>
        <Num label="Hours (empty for no target)" value={d.hours} onChange={(v) => setD({ ...d, hours: v })} testId={`sub-hours-${sub.id}`} />
      </div>
      {bad && (
        <p className="notice" role="alert">
          {bad}
        </p>
      )}
      <div className="row wrap">
        <button
          type="button"
          className="btn small"
          aria-label={`Save ${sub.label}`}
          data-testid={`sub-save-${sub.id}`}
          onClick={() => {
            const h = hoursOf(d.hours);
            if (h === undefined || !d.label.trim()) return setBad("Give the sub-process a name; hours are a number, zero or more, or empty.");
            setBad("");
            run((p, actor) => updateFigureItem(p, plan.id, "subProcesses", sub.id, { label: d.label, feedsStepId: d.feeds || undefined, processingTarget: h === null ? undefined : { comparator: d.cmp, hours: h } }, actor), "Sub-process saved");
          }}
        >
          Save
        </button>
        <button type="button" className="btn small danger" aria-label={`Remove ${sub.label}`} data-testid={`sub-remove-${sub.id}`} onClick={() => run((p, actor) => removeFigureItem(p, plan.id, "subProcesses", sub.id, actor), "Sub-process removed")}>
          Remove
        </button>
      </div>
    </fieldset>
  );
}
