import { removePoint, updatePoint } from "@gap/engine";
import { FLOW_POSITIONS, SAMPLING_TYPES, reportOnlyAllowed, type FlowPosition, type SamplingPlan, type SamplingPoint, type SamplingType } from "@gap/process-model";
import { METHOD_LABEL, NOT_ON_DIAGRAM, POSITION_NOT_SET, STATUS_TEXT, SLOT_LABEL, TYPE_LABEL, checkPoint, methodInputsText, tableOrder, typeCode, unitsPerBatch, usesSampleSizeMethod, stepOf } from "@gap/sampling";
import { useMemo } from "react";
import { PointRiskLinks } from "./RiskLinks";
import { movePoint, targetOf, type OpenAdd, type Run } from "./SamplingFlow";

/*
 * The points table under the process flow diagram.
 *
 * Design notes (the why):
 *  - SAME DATA AS THE DIAGRAM. The rows come from tableOrder(plan) (diagram points by step order and slot, then the points that are not
 *    on the diagram), read from the same plan the diagram draws. There is no second copy: changing Step or Position here goes through
 *    the same movePoint function as a drop on the diagram, so the marker moves at once and the change log has one kind of entry.
 *  - The table is the keyboard- and screen-reader-friendly way to do everything the diagram does by dragging.
 *  - Selection is shared with the diagram: the selected row has aria-current and an outline (plus a "Selected" word, never colour alone).
 *  - Position is optional. "Position not set" and "Not on the diagram" are normal choices, never flagged as a problem.
 *  - Edit opens the full point form in the interview, as before; this table only changes the four things the diagram also shows.
 */

export function PointsTable({
  plan,
  selectedId,
  highlightId,
  onHighlight,
  onSelect,
  run,
  onEdit,
  openAdd,
}: {
  plan: SamplingPlan;
  selectedId: string | null;
  /** The sample the pointer or focus is on in the figure (M10); its row is outlined. */
  highlightId?: string | null;
  onHighlight?: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  run: Run;
  onEdit: (id: string) => void;
  openAdd: OpenAdd;
}) {
  const rows = useMemo(() => tableOrder(plan), [plan]);
  return (
    <>
      {rows.length === 0 ? (
        <p className="muted" data-testid="points-empty">
          No sampling points yet. Add one from the suggestions above, with the plus button on a step of the diagram, or with Add a sample.
        </p>
      ) : (
        <div className="table-scroll" role="region" aria-label="Sampling points table" tabIndex={0}>
          <table className="data points-table" data-testid="points-table">
            <caption className="visually-hidden">Sampling points in process order: step, position, type, what is tested, sample amount and status</caption>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Step</th>
                <th scope="col">Position</th>
                <th scope="col">Type</th>
                <th scope="col">What is tested</th>
                <th scope="col">Sample amount / size</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <PointRow key={p.id} plan={plan} point={p} selected={selectedId === p.id} highlighted={highlightId === p.id} onHighlight={onHighlight} onSelect={onSelect} run={run} onEdit={() => onEdit(p.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <button type="button" className="btn" data-testid="add-sample" onClick={() => openAdd({})}>
          Add a sample
        </button>
      </div>
    </>
  );
}

function PointRow({ plan, point, selected, highlighted, onHighlight, onSelect, run, onEdit }: { plan: SamplingPlan; point: SamplingPoint; selected: boolean; highlighted?: boolean; onHighlight?: (id: string | null) => void; onSelect: (id: string | null) => void; run: Run; onEdit: () => void }) {
  const check = useMemo(() => checkPoint(plan, point), [plan, point]);
  const units = useMemo(() => unitsPerBatch(plan, point), [plan, point]);
  const step = stepOf(plan, point);
  const here = targetOf(plan, point);
  const slot = here.kind === "slot" ? here.slot : "unset";

  const stepValue = step ? step.id : "";
  return (
    <tr data-testid={`point-${point.id}`} aria-current={selected ? "true" : undefined} className={[selected ? "row-selected" : "", highlighted ? "row-hl" : ""].filter(Boolean).join(" ") || undefined} data-highlighted={highlighted ? "true" : undefined} onMouseEnter={() => onHighlight?.(point.id)} onMouseLeave={() => onHighlight?.(null)} onFocus={() => onHighlight?.(point.id)} onBlur={() => onHighlight?.(null)} onClick={() => onSelect(selected ? null : point.id)}>
      <th scope="row">
        {point.id}
        {selected && <span className="small"> (selected)</span>}
        <div>
          <PointRiskLinks planId={plan.id} pointId={point.id} />
        </div>
      </th>
      <td onClick={(e) => e.stopPropagation()}>
        <select
          value={stepValue}
          aria-label={`Step of ${point.id}`}
          data-testid={`row-step-${point.id}`}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") movePoint(run, plan, point.id, { kind: "tray" });
            else movePoint(run, plan, point.id, { kind: "slot", stepId: v, slot });
          }}
        >
          <option value="">{NOT_ON_DIAGRAM}</option>
          {plan.steps.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <select
          value={here.kind === "slot" ? slot : ""}
          disabled={here.kind === "tray"}
          aria-label={`Position of ${point.id}`}
          data-testid={`row-pos-${point.id}`}
          onChange={(e) => {
            if (here.kind !== "slot") return;
            movePoint(run, plan, point.id, { kind: "slot", stepId: here.stepId, slot: e.target.value as FlowPosition | "unset" });
          }}
        >
          {here.kind === "tray" && <option value="">Not applicable</option>}
          <option value="unset">{POSITION_NOT_SET}</option>
          {FLOW_POSITIONS.map((f) => (
            <option key={f} value={f}>
              {SLOT_LABEL[f]}
            </option>
          ))}
        </select>
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <select
          value={point.type ?? ""}
          aria-label={`Type of ${point.id}`}
          data-testid={`row-type-${point.id}`}
          onChange={(e) => {
            const t = e.target.value as SamplingType | "";
            // "Not chosen" is a state the model has (a migrated point has no type until it is classified), so the type can be cleared back to it;
            // the point then shows the open item "Choose the study type". Report only is only allowed once a type that permits it is chosen, so
            // a report-only acceptance is dropped with the type (the same rule the point editor applies when the type changes).
            const acceptance = point.acceptance?.kind === "report_only" && !reportOnlyAllowed(t || undefined) ? { acceptance: undefined } : {};
            run((p, actor) => updatePoint(p, plan.id, point.id, { type: t || undefined, ...acceptance }, actor), `Point ${point.id} type changed`);
          }}
        >
          <option value="">Not chosen ({typeCode(undefined)})</option>
          {SAMPLING_TYPES.map((t) => (
            <option key={t} value={t}>
              {typeCode(t)} {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <input
          // Keyed by the stored text so a change made elsewhere (the interview form) replaces what is shown.
          key={point.attribute}
          defaultValue={point.attribute}
          placeholder="Not named"
          aria-label={`What is tested at ${point.id}`}
          data-testid={`row-what-${point.id}`}
          onBlur={(e) => {
            if (e.target.value.trim() !== point.attribute) run((p, actor) => updatePoint(p, plan.id, point.id, { attribute: e.target.value.trim() }, actor), `Point ${point.id} test changed`);
          }}
        />
      </td>
      <td className="small">
        {!usesSampleSizeMethod(point) ? "Not by sample-size method" : point.sampleSize.method ? METHOD_LABEL[point.sampleSize.method] : "No method chosen"}
        <div className="muted">{usesSampleSizeMethod(point) && point.sampleSize.method ? methodInputsText(point) : ""}</div>
        {units.length === 0 ? (
          <div className="muted">No batches</div>
        ) : (
          <ul className="plain-list">
            {units.map((u) => (
              <li key={u.batchId}>
                {u.batchLabel}: {u.text}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td>
        <span className={`sp-status sp-status-${check.status}`} data-testid={`status-${point.id}`}>
          <span aria-hidden="true">{check.status === "complete" ? "✓ " : "○ "}</span>
          {STATUS_TEXT[check.status]}
        </span>
        {check.problems.length > 0 && <div className="muted small">{check.problems.length} open</div>}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <div className="row wrap">
          <button type="button" className="btn small" onClick={onEdit} aria-label={`Open point ${point.id}`} data-testid={`edit-${point.id}`}>
            Open
          </button>
          <button
            type="button"
            className="btn small danger"
            aria-label={`Remove point ${point.id}`}
            data-testid={`remove-${point.id}`}
            onClick={() => run((p, actor) => removePoint(p, plan.id, point.id, actor), `Point ${point.id} removed`)}
          >
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}
