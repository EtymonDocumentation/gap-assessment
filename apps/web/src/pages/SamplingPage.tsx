import {
  acceptSuggestion,
  addBatch,
  addPoint,
  createPlan,
  deletePlan,
  planById,
  removeBatch,
  removePoint,
  samplingOpenItems,
  suggestPoints,
  SUGGESTION_SOURCE_LABEL,
  updateBatch,
  updatePlan,
  updatePoint,
  type PointSuggestion,
} from "@gap/engine";
import { SAMPLING_CATEGORIES, UNIT_OP_FINISHED_PRODUCT, UNIT_OP_NONE, type SamplingBatch, type SamplingCategory, type SamplingPlan, type SamplingPoint } from "@gap/process-model";
import { CATEGORY_LABEL, METHOD_LABEL, STATUS_TEXT, checkPoint, methodInputsText, planTotals, unitsPerBatch } from "@gap/sampling";
import { samplingSuggestions } from "@gap/content";
import { useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Empty, Modal } from "../components";
import { dateTime } from "../lib";
import { href, navigate } from "../router";
import { useContent, useStore } from "../store";
import { SamplingOutput } from "./SamplingOutput";
import { NumField, PointDialog } from "./SamplingPointDialog";

/** The sentence the page and the document both carry: what the tool does and what it leaves to people. */
export const SAMPLING_SCOPE_TEXT =
  "The tool works out sample sizes from the method you choose. It does not judge whether that choice is adequate for your process; that decision belongs to QA / statistics.";

/** Plan list and create page (no `plan` parameter) or the editor of one plan. */
export function SamplingPage({ params }: { params: URLSearchParams }) {
  const project = useStore((s) => s.project)!;
  const planId = params.get("plan");
  const plan = planId ? planById(project, planId) : undefined;
  return plan ? <PlanEditor plan={plan} /> : <PlanList missing={planId ?? undefined} />;
}

function PlanList({ missing }: { missing?: string | undefined }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const plans = project.sampling.plans;

  function create() {
    if (!title.trim()) return setError("Enter a title for the plan.");
    let newId = "";
    const err = update((p, actor) => {
      const r = createPlan(p, { title: title.trim() }, actor);
      newId = r.planId;
      return r.project;
    }, "Sampling plan created");
    if (err) return setError(err);
    setTitle("");
    setError("");
    navigate("/sampling", { plan: newId });
  }

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>Sampling plan</h1>
      </PageBanner>
      <section className="card stack" aria-labelledby="sp-about">
        <h2 id="sp-about">What this is</h2>
        <p data-testid="sampling-scope-text">{SAMPLING_SCOPE_TEXT}</p>
        <ul className="plain-list">
          <li>A plan lists which samples are pulled from which process steps during the PPQ batches, and how many.</li>
          <li>Nothing is filled in for you. A decision you have not made stays a visible open item.</li>
          <li>Suggestions come from the receiving unit (RU) data of this project. A suggestion becomes a point only when you add it.</li>
          <li>The plan is a draft and never says that a plan is approved.</li>
        </ul>
        <p>
          Company sampling tables are kept on the <a href={href("/sampling/tables")}>Sampling tables</a> page.
        </p>
      </section>

      {missing && (
        <p className="notice" role="alert">
          There is no plan {missing} in this project.
        </p>
      )}

      <section className="card stack" aria-labelledby="sp-plans">
        <h2 id="sp-plans">Plans in this project</h2>
        {plans.length === 0 ? (
          <Empty>No sampling plan yet. Create one below.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Sampling plans table" tabIndex={0}>
            <table className="data" data-testid="plan-list">
              <thead>
                <tr>
                  <th scope="col">Plan</th>
                  <th scope="col">Batches</th>
                  <th scope="col">Points</th>
                  <th scope="col">Open items</th>
                  <th scope="col">Last changed</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <PlanRow key={p.id} plan={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form
          className="row wrap end-align"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label className="field grow">
            <span>New plan title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. PPQ sampling, filling line 2 (fictional)" data-testid="plan-title-input" />
          </label>
          <button type="submit" className="btn primary" data-testid="plan-create">
            Create plan
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

function PlanRow({ plan }: { plan: SamplingPlan }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const open = samplingOpenItems(content, project, plan).length;
  return (
    <tr>
      <th scope="row">
        <a href={href("/sampling", { plan: plan.id })}>
          {plan.id}: {plan.title}
        </a>
      </th>
      <td className="num">{plan.batches.length}</td>
      <td className="num">{plan.points.length}</td>
      <td className="num">{open}</td>
      <td className="small">{dateTime(plan.updatedAt)}</td>
    </tr>
  );
}

// ------------------------------------------------------------------ the editor

function PlanEditor({ plan }: { plan: SamplingPlan }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const update = useStore((s) => s.update);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  /** Runs one edit. Any refusal (for example removing a batch a point depends on) is shown in words next to the controls. */
  const run = (fn: Parameters<typeof update>[0], status: string): boolean => {
    const err = update(fn, status);
    setError(err ?? "");
    return !err;
  };

  const open = useMemo(() => samplingOpenItems(content, project, plan), [content, project, plan]);
  const suggestions = useMemo(() => suggestPoints(content, project, samplingSuggestions, plan), [content, project, plan]);
  const totals = useMemo(() => planTotals(plan), [plan]);
  const editingPoint = plan.points.find((p) => p.id === editing);
  const labelOf = useMemo(() => {
    const m = new Map(content.catalog.unitOperations.map((u) => [u.key, u.label]));
    m.set(UNIT_OP_FINISHED_PRODUCT, "Finished product");
    m.set(UNIT_OP_NONE, "Supporting work (no single step)");
    return (k: string) => m.get(k) ?? k;
  }, [content]);

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>
          {plan.id}: {plan.title}
        </h1>
      </PageBanner>
      <p className="no-print">
        <a href={href("/sampling")}>All sampling plans</a>
      </p>
      <p className="muted" data-testid="sampling-scope-text">
        {SAMPLING_SCOPE_TEXT}
      </p>
      {error && (
        <p className="notice" role="alert" data-testid="sampling-error">
          {error}
        </p>
      )}

      <DetailsCard plan={plan} run={run} />
      <BatchesCard plan={plan} run={run} />

      <section className="card stack" aria-labelledby="sp-open" data-testid="plan-open-items">
        <h2 id="sp-open">Open items ({open.length})</h2>
        {open.length === 0 ? (
          <p>No open items. This says the entries are all there, not that the plan is adequate; that decision belongs to QA / statistics.</p>
        ) : (
          <ul className="plain-list small">
            {open.map((o, i) => (
              <li key={i}>
                <strong>{o.ref}</strong>: {o.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <SuggestionsCard
        suggestions={suggestions}
        onAdd={(s) => run((p, actor) => acceptSuggestion(p, plan.id, s, actor).project, `Point added from a suggestion`)}
      />

      <section className="card stack" aria-labelledby="sp-points">
        <h2 id="sp-points">Sampling points ({plan.points.length})</h2>
        {plan.points.length === 0 ? (
          <Empty>No sampling points yet. Add one from the suggestions above or by hand below.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Sampling points table" tabIndex={0}>
            <table className="data points-table" data-testid="points-table">
              <caption className="visually-hidden">Sampling points with method, units per batch and status</caption>
              <thead>
                <tr>
                  <th scope="col">Point</th>
                  <th scope="col">Process step</th>
                  <th scope="col">Attribute</th>
                  <th scope="col">Category</th>
                  <th scope="col">Method</th>
                  <th scope="col">Units per batch</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {plan.points.map((p) => (
                  <PointRow
                    key={p.id}
                    plan={plan}
                    point={p}
                    step={labelOf(p.unitOp)}
                    onEdit={(el) => {
                      opener.current = el;
                      setEditing(p.id);
                    }}
                    onRemove={() => run((pr, actor) => removePoint(pr, plan.id, p.id, actor), `Point ${p.id} removed`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ManualAdd
          steps={[...content.catalog.unitOperations.map((u) => ({ key: u.key, label: u.label })), { key: UNIT_OP_FINISHED_PRODUCT, label: "Finished product" }, { key: UNIT_OP_NONE, label: "Supporting work (no single step)" }]}
          onAdd={(unitOp, category, attribute) => {
            let id = "";
            const ok = run((p, actor) => {
              const r = addPoint(p, plan.id, { unitOp, category, ...(attribute.trim() ? { attribute: attribute.trim() } : {}) }, actor);
              id = r.pointId;
              return r.project;
            }, "Point added");
            if (ok) setEditing(id);
          }}
        />
      </section>

      <section className="card stack" aria-labelledby="sp-totals" data-testid="plan-totals">
        <h2 id="sp-totals">Sample totals per batch</h2>
        {plan.batches.length === 0 ? (
          <Empty>Add batches to see totals.</Empty>
        ) : (
          <>
            <div className="table-scroll" role="region" aria-label="Sample totals table" tabIndex={0}>
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Batch</th>
                    <th scope="col">Units taken (points worked out)</th>
                    <th scope="col">Not worked out</th>
                    <th scope="col">100% of lot</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.perBatch.map((b) => (
                    <tr key={b.batchId}>
                      <th scope="row">{b.batchLabel}</th>
                      <td className="num">{b.units}</td>
                      <td className="small">{b.notWorkedOut.join(", ") || "None"}</td>
                      <td className="small">{b.hundredPercent.join(", ") || "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totals.notes.map((n) => (
              <p key={n} className="small muted">
                {n}
              </p>
            ))}
          </>
        )}
      </section>

      <SamplingOutput plan={plan} />

      <section className="card stack no-print" aria-labelledby="sp-delete">
        <h2 id="sp-delete">Delete this plan</h2>
        <p className="muted small">The plan leaves the project. The change log keeps what it said.</p>
        <div>
          <button
            type="button"
            className="btn danger"
            data-testid="plan-delete"
            onClick={(e) => {
              opener.current = e.currentTarget;
              setConfirmDelete(true);
            }}
          >
            Delete plan
          </button>
        </div>
      </section>

      {editingPoint && (
        <PointDialog
          plan={plan}
          point={editingPoint}
          onClose={() => setEditing(null)}
          onSave={(d) => {
            const { id: _id, origin: _o, createdAt: _c, updatedAt: _u, ...patch } = d;
            const ok = run((p, actor) => updatePoint(p, plan.id, editingPoint.id, patch, actor), `Point ${d.id} saved`);
            if (ok) setEditing(null);
            // A refusal is shown inside the dialog; run() has also put it on the page.
            return ok ? null : "The point was not saved. See the message on the page.";
          }}
        />
      )}

      {confirmDelete && (
        <Modal open onOpenChange={(o) => !o && setConfirmDelete(false)} title="Delete this plan?" description={`${plan.id}: ${plan.title} has ${plan.points.length} points and ${plan.batches.length} batches.`} restoreFocus={() => opener.current}>
          <div className="row end">
            <button type="button" className="btn" autoFocus onClick={() => setConfirmDelete(false)}>
              Keep the plan
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="plan-delete-confirm"
              onClick={() => {
                setConfirmDelete(false);
                if (run((p, actor) => deletePlan(p, plan.id, actor), "Sampling plan deleted")) navigate("/sampling");
              }}
            >
              Delete plan
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

type Run = (fn: Parameters<ReturnType<typeof useStore.getState>["update"]>[0], status: string) => boolean;

function DetailsCard({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const [title, setTitle] = useState(plan.title);
  const [notes, setNotes] = useState(plan.notes ?? "");
  const [why, setWhy] = useState(plan.batchRationale);
  const dirty = title !== plan.title || notes !== (plan.notes ?? "") || why !== plan.batchRationale;
  return (
    <section className="card stack" aria-labelledby="sp-details">
      <h2 id="sp-details">Plan details</h2>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="plan-title" />
      </label>
      <label className="field">
        <span>
          Notes <span className="muted">(optional)</span>
        </span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label className="field">
        <span>Why this number of PPQ batches</span>
        <textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} data-testid="plan-batch-rationale" />
        <span className="muted small">The tool does not suggest a number of batches. Write the reason your team decided on.</span>
      </label>
      <div>
        <button
          type="button"
          className="btn primary"
          disabled={!dirty || !title.trim()}
          data-testid="plan-details-save"
          onClick={() => run((p, actor) => updatePlan(p, plan.id, { title: title.trim(), notes: notes.trim() || undefined, batchRationale: why }, actor), "Plan details saved")}
        >
          Save plan details
        </button>
      </div>
    </section>
  );
}

function BatchesCard({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const [label, setLabel] = useState("");
  return (
    <section className="card stack" aria-labelledby="sp-batches">
      <h2 id="sp-batches">PPQ batches ({plan.batches.length})</h2>
      <p className="muted small">The number of batches is your decision. The planned lot size, in containers, is what the sampling tables read.</p>
      {plan.batches.length === 0 ? (
        <Empty>No batches yet. Add the first one below.</Empty>
      ) : (
        <div className="stack">
          {plan.batches.map((b) => (
            <BatchRow key={`${b.id}-${JSON.stringify(b)}`} plan={plan} batch={b} run={run} />
          ))}
        </div>
      )}
      <form
        className="row wrap end-align"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return;
          if (run((p, actor) => addBatch(p, plan.id, { label: label.trim() }, actor).project, "Batch added")) setLabel("");
        }}
      >
        <label className="field grow">
          <span>New batch label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. PPQ batch 1" data-testid="batch-label-input" />
        </label>
        <button type="submit" className="btn" data-testid="batch-add">
          Add batch
        </button>
      </form>
    </section>
  );
}

function BatchRow({ plan, batch, run }: { plan: SamplingPlan; batch: SamplingBatch; run: Run }) {
  const [label, setLabel] = useState(batch.label);
  const [lot, setLot] = useState(batch.plannedLotSizeUnits);
  const [size, setSize] = useState(batch.batchSize);
  const [unit, setUnit] = useState(batch.batchSizeUnit ?? "");
  const [notes, setNotes] = useState(batch.notes ?? "");
  const dirty = label !== batch.label || lot !== batch.plannedLotSizeUnits || size !== batch.batchSize || unit !== (batch.batchSizeUnit ?? "") || notes !== (batch.notes ?? "");
  return (
    <fieldset className="stack fs" data-testid={`batch-${batch.id}`}>
      <legend>{batch.id}</legend>
      <div className="row wrap">
        <label className="field">
          <span>Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} data-testid={`batch-label-${batch.id}`} />
        </label>
        <NumField label="Planned lot size (containers)" value={lot} onChange={(v) => setLot(v === undefined ? undefined : Math.trunc(v))} testId={`batch-lot-${batch.id}`} />
        <NumField label="Batch size (optional)" value={size} onChange={setSize} />
        <label className="field">
          <span>Batch size unit</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. L" />
        </label>
      </div>
      <label className="field">
        <span>
          Notes <span className="muted">(optional)</span>
        </span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="row wrap">
        <button
          type="button"
          className="btn primary"
          disabled={!dirty || !label.trim()}
          data-testid={`batch-save-${batch.id}`}
          onClick={() =>
            run(
              (p, actor) => updateBatch(p, plan.id, batch.id, { label: label.trim(), plannedLotSizeUnits: lot, batchSize: size === undefined || size <= 0 ? undefined : size, batchSizeUnit: unit.trim() || undefined, notes: notes.trim() || undefined }, actor),
              `Batch ${batch.id} saved`,
            )
          }
        >
          Save batch
        </button>
        <button type="button" className="btn danger" onClick={() => run((p, actor) => removeBatch(p, plan.id, batch.id, actor), `Batch ${batch.id} removed`)}>
          Remove batch
        </button>
      </div>
    </fieldset>
  );
}

function SuggestionsCard({ suggestions, onAdd }: { suggestions: PointSuggestion[]; onAdd: (s: PointSuggestion) => void }) {
  const open = suggestions.filter((s) => !s.added).length;
  return (
    <section className="card stack" aria-labelledby="sp-sugg" data-testid="suggestions">
      <h2 id="sp-sugg">Suggestions ({open} not added)</h2>
      <p className="muted small">
        Offered from the RU data of this project and a list of common PPQ candidates. Steps you left out of the scope are not offered. A suggestion carries no sample size, criterion or method: adding it creates an incomplete point for you to fill in.
      </p>
      {suggestions.length === 0 ? (
        <Empty>No suggestions. Check the Scope step.</Empty>
      ) : (
        <details>
          <summary data-testid="suggestions-toggle">Show the suggestions</summary>
          <div className="table-scroll" role="region" aria-label="Suggestions table" tabIndex={0}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Process step</th>
                  <th scope="col">Suggestion</th>
                  <th scope="col">Why it is offered</th>
                  <th scope="col">Gaps</th>
                  <th scope="col">Add</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.id} data-testid="suggestion-row">
                    <th scope="row">{s.uoLabel}</th>
                    <td>
                      {s.attribute}
                      <div className="muted small">
                        {SUGGESTION_SOURCE_LABEL[s.source]}; {CATEGORY_LABEL[s.category]}
                      </div>
                    </td>
                    <td className="small">{s.why}</td>
                    <td className="small">{s.gapIds.join(", ") || "None"}</td>
                    <td>
                      {s.added ? (
                        <span>Added</span>
                      ) : (
                        <button type="button" className="btn small" onClick={() => onAdd(s)} aria-label={`Add point: ${s.attribute} (${s.uoLabel})`}>
                          Add as point
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

function PointRow({ plan, point, step, onEdit, onRemove }: { plan: SamplingPlan; point: SamplingPoint; step: string; onEdit: (el: HTMLElement) => void; onRemove: () => void }) {
  const check = useMemo(() => checkPoint(plan, point), [plan, point]);
  const units = useMemo(() => unitsPerBatch(plan, point), [plan, point]);
  return (
    <tr data-testid={`point-${point.id}`}>
      <th scope="row">{point.id}</th>
      <td>{step}</td>
      <td>{point.attribute || <span className="muted">Not named</span>}</td>
      <td className="small">{CATEGORY_LABEL[point.category as SamplingCategory]}</td>
      <td className="small">
        {point.sampleSize.method ? METHOD_LABEL[point.sampleSize.method] : "No method chosen"}
        <div className="muted">{point.sampleSize.method ? methodInputsText(point) : ""}</div>
      </td>
      <td className="small">
        {units.length === 0 ? (
          "No batches"
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
      <td>
        <div className="row wrap">
          <button type="button" className="btn small" onClick={(e) => onEdit(e.currentTarget)} aria-label={`Edit point ${point.id}`} data-testid={`edit-${point.id}`}>
            Edit
          </button>
          <button type="button" className="btn small danger" onClick={onRemove} aria-label={`Remove point ${point.id}`}>
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}

function ManualAdd({ steps, onAdd }: { steps: { key: string; label: string }[]; onAdd: (unitOp: string, category: SamplingCategory, attribute: string) => void }) {
  const [unitOp, setUnitOp] = useState("");
  const [category, setCategory] = useState<SamplingCategory | "">("");
  const [attribute, setAttribute] = useState("");
  return (
    <form
      className="row wrap end-align"
      aria-label="Add a point by hand"
      onSubmit={(e) => {
        e.preventDefault();
        if (!unitOp || !category) return;
        onAdd(unitOp, category, attribute);
        setAttribute("");
      }}
    >
      <label className="field">
        <span>Process step</span>
        <select value={unitOp} onChange={(e) => setUnitOp(e.target.value)} data-testid="manual-unitop">
          <option value="">Choose</option>
          {steps.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value as SamplingCategory | "")} data-testid="manual-category">
          <option value="">Choose</option>
          {SAMPLING_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field grow">
        <span>
          Attribute <span className="muted">(optional now)</span>
        </span>
        <input value={attribute} onChange={(e) => setAttribute(e.target.value)} data-testid="manual-attribute" />
      </label>
      <button type="submit" className="btn" disabled={!unitOp || !category} data-testid="manual-add">
        Add point
      </button>
    </form>
  );
}
