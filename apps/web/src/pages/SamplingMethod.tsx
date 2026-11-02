import { updatePlan } from "@gap/engine";
import {
  SAMPLE_ACCESS,
  SAMPLE_ACCESS_LABEL,
  SAMPLE_CLOSED_SYSTEM,
  SAMPLE_FLUSH_LABEL,
  SAMPLE_FLUSH_PRACTICES,
  type SampleMethod,
  type SamplingPlan,
  type SamplingPoint,
} from "@gap/process-model";
import { isBagSample, methodStarted, planMethodReminders, samplingMethodReminders, type MethodReminder } from "@gap/sampling";
import { useId, useState, type ReactNode } from "react";
import type { Run } from "./SamplingFlow";

/**
 * "How the sample is taken": the optional method questions of a sampling point, and the plan-level switch that asks them for every point.
 * Every choice is a radio group with a visible "Not stated" option, which is what is selected until the person answers: the tool never
 * preselects an answer. Reminders are listed as text (not colour only) and never block saving or completeness.
 */

const opt = (s: string): string | undefined => (s.trim() === "" ? undefined : s);

/** A radio group of choices plus "Not stated". `value` undefined = not stated. */
function Choice<T extends string>({ legend, value, options, onChange, testId }: { legend: string; value: T | undefined; options: readonly { value: T; label: string }[]; onChange: (v: T | undefined) => void; testId: string }) {
  const name = useId();
  return (
    <fieldset className="fs stack" data-testid={testId}>
      <legend>{legend}</legend>
      <div className="check-grid">
        <label className="check">
          <input type="radio" name={name} checked={value === undefined} onChange={() => onChange(undefined)} data-testid={`${testId}-unset`} />
          <span>Not stated</span>
        </label>
        {options.map((o) => (
          <label key={o.value} className="check">
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} data-testid={`${testId}-${o.value}`} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

function YesNo({ legend, value, onChange, testId }: { legend: string; value: boolean | undefined; onChange: (v: boolean | undefined) => void; testId: string }) {
  return <Choice legend={legend} value={value === undefined ? undefined : value ? "yes" : "no"} options={YES_NO} onChange={(v) => onChange(v === undefined ? undefined : v === "yes")} testId={testId} />;
}

function Text({ label, value, onChange, testId, hint }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; testId: string; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value ?? ""} onChange={(e) => onChange(opt(e.target.value))} data-testid={testId} />
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

export function ReminderList({ reminders, testId }: { reminders: MethodReminder[]; testId: string }) {
  if (reminders.length === 0) return null;
  return (
    <ul className="plain-list stack" data-testid={testId}>
      {reminders.map((r, i) => (
        <li key={i} className="small">
          <strong>{r.severity === "open" ? "Not stated:" : "Detail missing:"}</strong> {r.text}
        </li>
      ))}
    </ul>
  );
}

/** Volume and unit, both typed or chosen by the person (no preset unit). The pair is stored only when both are valid. */
function VolumeField({ value, onChange }: { value: { value: number; unit: string } | undefined; onChange: (v: { value: number; unit: string } | undefined) => void }) {
  const [num, setNum] = useState(value ? String(value.value) : "");
  const [unit, setUnit] = useState(value?.unit ?? "");
  const push = (n: string, u: string) => {
    const x = Number(n);
    onChange(n.trim() !== "" && x > 0 && u ? { value: x, unit: u } : undefined);
  };
  return (
    <div className="row wrap">
      <label className="field">
        <span>Volume</span>
        <input type="number" min="0" step="any" value={num} onChange={(e) => { setNum(e.target.value); push(e.target.value, unit); }} data-testid="method-flush-volume" />
      </label>
      <label className="field">
        <span>Unit</span>
        <select value={unit} onChange={(e) => { setUnit(e.target.value); push(num, e.target.value); }} data-testid="method-flush-unit">
          <option value="">Choose a unit</option>
          <option value="mL">mL</option>
          <option value="L">L</option>
        </select>
      </label>
    </div>
  );
}

const tidy = (m: SampleMethod): SampleMethod | undefined => {
  // Drop empty sub-objects so "not stated" stays absent in the stored point (no stored defaults, no empty shells).
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = tidy(v as SampleMethod) as Record<string, unknown> | undefined;
      if (inner) out[k] = inner;
    } else if (Array.isArray(v)) {
      if (v.length) out[k] = v;
    } else out[k] = v;
  }
  return Object.keys(out).length ? (out as SampleMethod) : undefined;
};

export function MethodSection({ plan, d, set }: { plan: SamplingPlan; d: SamplingPoint; set: (patch: Partial<SamplingPoint>) => void }) {
  const m: SampleMethod = d.method ?? {};
  const patch = (p: Partial<SampleMethod>) => {
    const next = tidy({ ...m, ...p });
    // `set` merges; to remove the whole method an explicit undefined is written (updatePoint then deletes the key).
    set({ method: next });
  };
  const sub = <K extends "added" | "flush" | "shared" | "bag">(k: K, p: Partial<NonNullable<SampleMethod[K]>>) => patch({ [k]: { ...(m[k] ?? {}), ...p } } as Partial<SampleMethod>);
  const reminders = samplingMethodReminders(d, plan);
  const others = plan.points.filter((x) => x.id !== d.id);
  const added = m.added?.forStudyOnly === true || m.access === "added_y_connector";
  const portLike = m.access !== undefined && m.access !== "grab_open" && m.access !== "other";
  const bagRelevant = isBagSample(d);
  const summary = methodStarted(d.method) ? "answered in part" : "not stated";
  return (
    <details className="point-group" data-testid="point-howtaken">
      <summary data-testid="point-howtaken-summary">
        <strong>How the sample is taken</strong> <span className="muted small">(optional; {summary}{reminders.length ? `; ${reminders.length} reminder${reminders.length === 1 ? "" : "s"}` : ""})</span>
      </summary>
      <div className="stack">
        <p className="muted small">
          Ports and connectors added only to pull development or PPQ samples are a common source of sampling errors. These questions are optional and the tool does not choose an answer. The container and who takes the sample are set elsewhere on this point.
        </p>
        <Choice legend="How is the sample taken?" value={m.access} options={SAMPLE_ACCESS.map((v) => ({ value: v, label: SAMPLE_ACCESS_LABEL[v] }))} onChange={(v) => patch({ access: v })} testId="method-access" />
        {m.access === "other" && <Text label="Describe the other way" value={m.accessOther} onChange={(v) => patch({ accessOther: v })} testId="method-access-other" />}

        {(m.access === "dedicated_port" || m.access === "shared_port" || m.access === "added_y_connector") && (
          <YesNo legend="Was the port or connector added only for development or PPQ sampling?" value={m.added?.forStudyOnly} onChange={(v) => sub("added", { forStudyOnly: v })} testId="method-added" />
        )}
        {added && (
          <fieldset className="fs stack" data-testid="method-added-group">
            <legend>The added port or connector</legend>
            <YesNo legend="Is it in the commercial assembly?" value={m.added?.inCommercialAssembly} onChange={(v) => sub("added", { inCommercialAssembly: v })} testId="method-added-commercial" />
            <YesNo legend="Is the modified assembly covered by the single-use assembly qualification (for example extractables)?" value={m.added?.validatedAssembly} onChange={(v) => sub("added", { validatedAssembly: v })} testId="method-added-validated" />
            <YesNo legend="Is it removed after the study?" value={m.added?.removedAfter} onChange={(v) => sub("added", { removedAfter: v })} testId="method-added-removed" />
            <Text label="Note (optional)" value={m.added?.note} onChange={(v) => sub("added", { note: v })} testId="method-added-note" />
          </fieldset>
        )}

        {portLike && (
          <fieldset className="fs stack" data-testid="method-flush-group">
            <legend>Flush before the sample</legend>
            <Choice legend="What is done?" value={m.flush?.practice} options={SAMPLE_FLUSH_PRACTICES.map((v) => ({ value: v, label: SAMPLE_FLUSH_LABEL[v] }))} onChange={(v) => sub("flush", { practice: v })} testId="method-flush" />
            {(m.flush?.practice === "flush_volume" || m.flush?.practice === "first_draw_discard") && (
              <>
                <VolumeField value={m.flush?.volume} onChange={(v) => sub("flush", { volume: v })} />
                <Text label="Where does the flushed or discarded liquid go?" value={m.flush?.discardTo} onChange={(v) => sub("flush", { discardTo: v })} testId="method-flush-discard" />
              </>
            )}
            {m.flush?.practice === "none_stated_reason" && <Text label="Why is the port not flushed?" value={m.flush?.reason} onChange={(v) => sub("flush", { reason: v })} testId="method-flush-reason" />}
          </fieldset>
        )}

        {m.access === "shared_port" && (
          <fieldset className="fs stack" data-testid="method-shared-group">
            <legend>Port shared with other samples</legend>
            {others.length === 0 ? (
              <p className="muted small">There are no other sampling points in this plan yet.</p>
            ) : (
              <div role="group" aria-label="Other samples drawn from the same port" className="check-grid">
                {others.map((o) => (
                  <label key={o.id} className="check">
                    <input
                      type="checkbox"
                      checked={m.shared?.pointIds?.includes(o.id) ?? false}
                      onChange={(e) => {
                        const cur = m.shared?.pointIds ?? [];
                        sub("shared", { pointIds: e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id) });
                      }}
                      data-testid={`method-shared-${o.id}`}
                    />
                    <span>
                      {o.id}: {o.attribute.trim() || "(no test)"}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <Text label="Order the samples are drawn in" value={m.shared?.order} onChange={(v) => sub("shared", { order: v })} testId="method-shared-order" hint="For example: bioburden first, then endotoxin." />
            <YesNo legend="Is the port flushed between samples?" value={m.shared?.flushBetween} onChange={(v) => sub("shared", { flushBetween: v })} testId="method-shared-flush" />
          </fieldset>
        )}

        <fieldset className="fs stack" data-testid="method-bag-group">
          <legend>Sample from a bag or hold vessel</legend>
          <label className="check">
            <input type="checkbox" checked={m.bag?.fromBag === true} onChange={(e) => sub("bag", { fromBag: e.target.checked ? true : undefined })} data-testid="method-bag-from" />
            <span>This sample is drawn from a bag or hold vessel{d.flow?.holdId && m.bag?.fromBag !== true ? " (this point sits on a hold)" : ""}</span>
          </label>
          {bagRelevant && (
            <>
              <YesNo legend="Is the bag mixed before the sample is drawn?" value={m.bag?.mixedFirst} onChange={(v) => sub("bag", { mixedFirst: v })} testId="method-bag-mixed" />
              {m.bag?.mixedFirst === true && <Text label="How long is it mixed?" value={m.bag?.mixingTime} onChange={(v) => sub("bag", { mixingTime: v })} testId="method-bag-time" />}
              <Text label="Where on the bag is the sample drawn?" value={m.bag?.drawFrom} onChange={(v) => sub("bag", { drawFrom: v })} testId="method-bag-draw" hint="For example the bottom port or a sample manifold." />
            </>
          )}
        </fieldset>

        <Choice
          legend="Closed or open?"
          value={m.closedSystem}
          options={SAMPLE_CLOSED_SYSTEM.map((v) => ({ value: v, label: v === "closed" ? "Closed system" : "Open (drawn under a room or hood class)" }))}
          onChange={(v) => patch({ closedSystem: v })}
          testId="method-closed"
        />
        {m.closedSystem === "open" && <Text label="Room or hood class" value={m.openClass} onChange={(v) => patch({ openClass: v })} testId="method-open-class" />}
        <Text label="Note (optional)" value={m.note} onChange={(v) => patch({ note: v })} testId="method-note" />

        <div data-testid="method-reminders">
          {reminders.length > 0 ? (
            <>
              <h6>Reminders for this point</h6>
              <ReminderList reminders={reminders} testId="method-reminder-list" />
            </>
          ) : (
            <p className="muted small">{plan.askSampleMethod || methodStarted(d.method) ? "No reminders for this point." : "No reminders: the plan does not ask this question yet. Answering any of it, or switching on \"Ask how each sample is taken\" for the plan, turns reminders on."}</p>
          )}
        </div>
      </div>
    </details>
  );
}

/** Plan-level card: the optional practice switch and the list of reminders of every point. */
export function MethodCard({ plan, run }: { plan: SamplingPlan; run: Run }): ReactNode {
  const all = planMethodReminders(plan);
  const total = all.reduce((n, x) => n + x.reminders.length, 0);
  return (
    <section className="card stack" aria-labelledby="sp-method" data-testid="plan-method">
      <h2 id="sp-method">How each sample is taken</h2>
      <p className="muted small">
        Optional practice. Sampling ports, Y-connectors and bag draws are easy to get wrong (an unflushed port, several samples from one port in the wrong order, a bag that was not mixed). Switch this on to be reminded, for every point, of what is not stated yet. Reminders never block the plan and are not open items.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={plan.askSampleMethod === true}
          onChange={(e) => run((p, actor) => updatePlan(p, plan.id, { askSampleMethod: e.target.checked }, actor), e.target.checked ? "Sampling method questions switched on" : "Sampling method questions switched off")}
          data-testid="plan-method-switch"
        />
        <span>Ask how each sample is taken</span>
      </label>
      {total > 0 ? (
        <div data-testid="plan-method-reminders">
          <h3>{total} reminder{total === 1 ? "" : "s"} on {all.length} point{all.length === 1 ? "" : "s"}</h3>
          <ul className="plain-list stack">
            {all.map((x) => (
              <li key={x.pointId} data-testid={`plan-method-${x.pointId}`}>
                <strong>{x.pointId}</strong> {plan.points.find((p) => p.id === x.pointId)?.attribute.trim() || "(no test)"}
                <ReminderList reminders={x.reminders} testId={`plan-method-list-${x.pointId}`} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted small" data-testid="plan-method-none">{plan.askSampleMethod ? "No reminders: every question is answered." : "No reminders. Answer any method question on a point, or switch the practice on."}</p>
      )}
    </section>
  );
}
