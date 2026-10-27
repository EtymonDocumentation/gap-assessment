import {
  acceptSuggestion,
  addBatch,
  createPlan,
  deletePlan,
  planById,
  projectScopeSteps,
  removeBatch,
  removePoint,
  samplingOpenItems,
  suggestPoints,
  SUGGESTION_SOURCE_LABEL,
  updateBatch,
  updatePlan,
  type PointSuggestion,
} from "@gap/engine";
import { UNIT_OP_CUSTOM_STEP, UNIT_OP_FINISHED_PRODUCT, UNIT_OP_NONE, type SamplingBatch, type SamplingPlan } from "@gap/process-model";
import { TYPE_LABEL, planTotals } from "@gap/sampling";
import { samplingSuggestions } from "@gap/content";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Empty, Modal } from "../components";
import { dateTime } from "../lib";
import { href, navigate } from "../router";
import { useContent, useStore } from "../store";
import { AddSampleDialog, type AddRequest } from "./SamplingAdd";
import { FlowDiagram, type OpenAdd, type Run } from "./SamplingFlow";
import { PointsTable } from "./SamplingPointsTable";
import { ProcessStepsCard } from "./SamplingSteps";
import { FigureDataCard } from "./SamplingFigureData";
import { FigureView } from "./SamplingFigureView";
import { SamplingOutput } from "./SamplingOutput";
import { DesignCard } from "./SamplingDesign";
import { NumField } from "./SamplingPointDialog";
import { AgencyCard, Interview, PartiesCard, PointCard, type ViewBy } from "./SamplingInterview";
import { SubsectionsEditor } from "./SamplingSubsections";

type Tab = "overview" | "interview" | "subsections";
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", interview: "Interview", subsections: "Plan subsections" };

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
  const content = useContent();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const plans = project.sampling.plans;

  function create() {
    if (!title.trim()) return setError("Enter a title for the plan.");
    let newId = "";
    const err = update((p, actor) => {
      // One-time copy of the project scope's steps; after this the plan's steps are its own.
      const r = createPlan(p, { title: title.trim(), steps: projectScopeSteps(content, p) }, actor);
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
          Company sampling tables are kept on the <a href={href("/sampling/tables")}>Sampling tables</a> page. Reusable plan text is kept on the <a href={href("/sampling/subsections")}>Plan subsections</a> page.
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
  // The open point and the view are kept here so they survive switching tab or view.
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  // The sample under the pointer or focus in the figure or the table, so each highlights the other.
  const [hl, setHl] = useState<string | null>(null);
  const [view, setView] = useState<ViewBy>("step");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null);
  const addOpener = useRef<HTMLElement | null>(null);
  // A point just added is selected but its card stays a summary line until the person asks for More details.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // The point whose editor is open under the points table (the Overview twin of the interview's expanded card).
  const [overviewOpen, setOverviewOpen] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  /**
   * The ONE place every add control calls: the diagram's "+", the table's "Add a sample" and the add buttons of the interview. It opens
   * the add dialog (short form, or the step-by-step wizard if the person chose that), and remembers the opener so focus goes back to it.
   */
  const openAdd: OpenAdd = (t) => {
    addOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAddRequest(t);
  };
  /** Selecting a marker or a table row; it also ends the "just added" collapsed state. */
  const select = (id: string | null) => {
    setSelected(id);
    setJustAdded(null);
  };
  const interviewExpanded = selected !== null && justAdded !== selected ? selected : null;

  /** Runs one edit. Any refusal (for example removing a batch a point depends on) is shown in words next to the controls. */
  const run = (fn: Parameters<typeof update>[0], status: string): boolean => {
    const err = update(fn, status);
    setError(err ?? "");
    return !err;
  };

  const open = useMemo(() => samplingOpenItems(content, project, plan), [content, project, plan]);
  const selectedPoint = plan.points.find((p) => p.id === selected);
  const selectedCard = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(() => suggestPoints(content, project, samplingSuggestions, plan), [content, project, plan]);
  const totals = useMemo(() => planTotals(plan), [plan]);
  const labelOf = useMemo(() => {
    const m = new Map(content.catalog.unitOperations.map((u) => [u.key, u.label]));
    m.set(UNIT_OP_FINISHED_PRODUCT, "Finished product");
    m.set(UNIT_OP_NONE, "Supporting work (no single step)");
    m.set(UNIT_OP_CUSTOM_STEP, "Custom step");
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
      <ProcessStepsCard plan={plan} run={run} />
      <FigureDataCard plan={plan} run={run} />
      <BatchesCard plan={plan} run={run} />
      <DesignCard plan={plan} run={run} />

      <div role="group" aria-label="Plan sections" className="row wrap seg no-print" data-testid="plan-tabs">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button key={t} type="button" className={tab === t ? "btn primary" : "btn"} aria-pressed={tab === t} onClick={() => setTab(t)} data-testid={`tab-${t}`}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "interview" && (
        <>
          <PartiesCard plan={plan} run={run} />
          <Interview plan={plan} suggestions={suggestions} expanded={interviewExpanded} onToggle={(id) => select(interviewExpanded === id ? null : id)} openAdd={openAdd} view={view} onView={setView} run={run} labelOf={labelOf} />
          <AgencyCard plan={plan} run={run} />
        </>
      )}

      {tab === "subsections" && <SubsectionsEditor plan={plan} run={run} />}

      {tab === "overview" && (
      <>
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

      <FlowDiagram plan={plan} selectedId={selected} onSelect={select} run={run} openAdd={openAdd} />

      <FigureView plan={plan} highlightId={hl} onHighlight={setHl} onSelect={select} />

      <section className="card stack" aria-labelledby="sp-points">
        <h2 id="sp-points">Sampling points ({plan.points.length})</h2>
        <PointsTable
          plan={plan}
          selectedId={selected}
          highlightId={hl}
          onHighlight={setHl}
          onSelect={select}
          run={run}
          openAdd={openAdd}
          onEdit={(id) => {
            // The full editor is in the interview too, so Open shows that point there.
            select(id);
            setTab("interview");
          }}
        />
        <div role="status" className="visually-hidden" data-testid="add-announce">
          {announce}
        </div>
        {selectedPoint && (
          <div className="stack" data-testid="selected-point" ref={selectedCard}>
            <h3>Selected sample</h3>
            <PointCard
              key={selectedPoint.id}
              plan={plan}
              point={selectedPoint}
              step={labelOf(selectedPoint.unitOp)}
              expanded={overviewOpen === selectedPoint.id}
              openLabel="More details"
              onToggle={() => setOverviewOpen(overviewOpen === selectedPoint.id ? null : selectedPoint.id)}
              run={run}
              onRemove={() => run((p, actor) => removePoint(p, plan.id, selectedPoint.id, actor), `Point ${selectedPoint.id} removed`)}
            />
          </div>
        )}
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
                    <th scope="col">Process units taken (points worked out)</th>
                    <th scope="col">Stability units</th>
                    <th scope="col">Retain units</th>
                    <th scope="col">All units</th>
                    <th scope="col">Not worked out</th>
                    <th scope="col">100% of lot</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.perBatch.map((b) => (
                    <tr key={b.batchId}>
                      <th scope="row">{b.batchLabel}</th>
                      <td className="num">{b.units}</td>
                      <td className="num">{b.stabilityUnits}</td>
                      <td className="num">{b.retainUnits}</td>
                      <td className="num">{b.units + b.stabilityUnits + b.retainUnits}</td>
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

      </>
      )}

      {addRequest && (
        <AddSampleDialog
          plan={plan}
          request={addRequest}
          run={run}
          onClose={() => setAddRequest(null)}
          restoreFocus={() => addOpener.current}
          onAdded={(id) => {
            setAddRequest(null);
            setSelected(id);
            setJustAdded(id);
            setOverviewOpen(null);
            setAnnounce(`Point ${id} added. Its summary is under the points table; use More details to fill it in.`);
            // Bring the new summary into view without moving the page more than needed.
            window.setTimeout(() => selectedCard.current?.scrollIntoView({ block: "nearest" }), 0);
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

function DetailsCard({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const [title, setTitle] = useState(plan.title);
  const [notes, setNotes] = useState(plan.notes ?? "");
  const [why, setWhy] = useState(plan.batchRationale);
  const dirty = title !== plan.title || notes !== (plan.notes ?? "") || why !== plan.batchRationale;
  // Same pattern as the batch rows: a plan whose details are filled shows a read-only summary with Edit. A brand-new plan (no
  // batch rationale yet, the one detail the person still has to write) opens in the form, with nothing saved to go back to, so
  // no Cancel until the first save. "first" = that opening state; "edit" = reopened with Edit.
  const [mode, setMode] = useState<"first" | "edit" | undefined>(plan.batchRationale.trim() ? undefined : "first");
  const rootRef = useRef<HTMLElement>(null);
  // Where focus goes after the next render: Edit puts it in the first field, Save / Cancel put it back on Edit, so a keyboard
  // user never loses their place when the form swaps for the summary.
  const focusNext = useRef<"title" | "edit" | null>(null);
  const editing = mode !== undefined;
  useEffect(() => {
    const f = focusNext.current;
    if (!f) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-testid="${f === "title" ? "plan-title" : "plan-details-edit"}"]`)?.focus();
    focusNext.current = null;
  }, [editing]);
  const close = () => {
    focusNext.current = "edit";
    setMode(undefined);
  };

  if (!editing) {
    const n = plan.batches.length;
    return (
      <section className="card stack" aria-labelledby="sp-details" ref={rootRef}>
        <h2 id="sp-details">Plan details</h2>
        <div className="batch-summary" role="group" aria-label="Plan details summary" data-testid="plan-details-summary">
          <dl>
            <div>
              <dt>Title:</dt>
              <dd>
                <strong data-testid="plan-details-title-text">{plan.title}</strong>
              </dd>
            </div>
            <div>
              <dt>PPQ batches:</dt>
              <dd>{n === 0 ? "none yet" : `${n} (${plan.batches.map((b) => b.id).join(", ")})`}</dd>
            </div>
            <div>
              <dt>Why this number of batches:</dt>
              <dd data-testid="plan-details-rationale-text">{plan.batchRationale.trim() ? plan.batchRationale : "not given"}</dd>
            </div>
            {plan.notes ? (
              <div>
                <dt>Notes:</dt>
                <dd className="muted">{plan.notes}</dd>
              </div>
            ) : null}
          </dl>
          <div className="batch-actions">
            <button
              type="button"
              className="btn"
              aria-label="Edit plan details"
              data-testid="plan-details-edit"
              onClick={() => {
                focusNext.current = "title";
                setMode("edit");
              }}
            >
              Edit
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card stack" aria-labelledby="sp-details" ref={rootRef}>
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
      <div className="row wrap">
        <button
          type="button"
          className="btn primary"
          // A brand-new plan can be saved as it is to close the form; a saved one needs a change.
          disabled={(!dirty && mode !== "first") || !title.trim()}
          data-testid="plan-details-save"
          onClick={() => {
            if (run((p, actor) => updatePlan(p, plan.id, { title: title.trim(), notes: notes.trim() || undefined, batchRationale: why }, actor), "Plan details saved")) close();
          }}
        >
          Save plan details
        </button>
        {mode === "first" ? null : (
          <button
            type="button"
            className="btn"
            data-testid="plan-details-cancel"
            onClick={() => {
              // Back to what was saved, so reopening never shows abandoned typing.
              setTitle(plan.title);
              setNotes(plan.notes ?? "");
              setWhy(plan.batchRationale);
              close();
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Batch rows collapse to a read-only summary once answered, so three answered batches don't take up the page.
 * Which rows are open lives here, not in the row: BatchRow is keyed by its content and so remounts on every save.
 * "new" = just added (opens in edit, nothing saved yet to go back to, so no Cancel); "edit" = reopened with Edit.
 */
type BatchMode = "new" | "edit";
type FocusTarget = { id: string; to: "label" | "edit" };

function BatchesCard({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const [label, setLabel] = useState("");
  const [modes, setModes] = useState<Record<string, BatchMode>>({});
  // Where keyboard focus goes after the next render of a row; read by that row, which may be a fresh mount after a save.
  const focusNext = useRef<FocusTarget | null>(null);
  const setMode = (id: string, mode: BatchMode | undefined) =>
    setModes((m) => {
      const n = { ...m };
      if (mode) n[id] = mode;
      else delete n[id];
      return n;
    });
  return (
    <section className="card stack" aria-labelledby="sp-batches">
      <h2 id="sp-batches">PPQ batches ({plan.batches.length})</h2>
      <p className="muted small">The number of batches is your decision. The planned lot size, in containers, is what the sampling tables read.</p>
      {plan.batches.length === 0 ? (
        <Empty>No batches yet. Add the first one below.</Empty>
      ) : (
        <div className="stack">
          {plan.batches.map((b) => (
            <BatchRow
              key={`${b.id}-${JSON.stringify(b)}`}
              plan={plan}
              batch={b}
              run={run}
              mode={modes[b.id]}
              focusNext={focusNext}
              onEdit={() => {
                focusNext.current = { id: b.id, to: "label" };
                setMode(b.id, "edit");
              }}
              onClose={() => {
                focusNext.current = { id: b.id, to: "edit" };
                setMode(b.id, undefined);
              }}
            />
          ))}
        </div>
      )}
      <form
        className="row wrap end-align"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return;
          let newId = "";
          if (
            run((p, actor) => {
              const r = addBatch(p, plan.id, { label: label.trim() }, actor);
              newId = r.batchId;
              return r.project;
            }, "Batch added")
          ) {
            setLabel("");
            setMode(newId, "new");
          }
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

const fmtCount = (n: number) => n.toLocaleString("en-GB");

function BatchRow({
  plan,
  batch,
  run,
  mode,
  focusNext,
  onEdit,
  onClose,
}: {
  plan: SamplingPlan;
  batch: SamplingBatch;
  run: Run;
  mode: BatchMode | undefined;
  focusNext: React.MutableRefObject<FocusTarget | null>;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(batch.label);
  const [lot, setLot] = useState(batch.plannedLotSizeUnits);
  const [size, setSize] = useState(batch.batchSize);
  const [unit, setUnit] = useState(batch.batchSizeUnit ?? "");
  const [notes, setNotes] = useState(batch.notes ?? "");
  const rootRef = useRef<HTMLDivElement & HTMLFieldSetElement>(null);
  const editing = mode !== undefined;
  const isNew = mode === "new";
  const dirty = label !== batch.label || lot !== batch.plannedLotSizeUnits || size !== batch.batchSize || unit !== (batch.batchSizeUnit ?? "") || notes !== (batch.notes ?? "");

  // Keyboard users must not lose their place: Edit puts focus in the first field, Save / Cancel put it back on Edit.
  useEffect(() => {
    const f = focusNext.current;
    if (!f || f.id !== batch.id) return;
    const target = rootRef.current?.querySelector<HTMLElement>(f.to === "label" ? `[data-testid="batch-label-${batch.id}"]` : `[data-testid="batch-edit-${batch.id}"]`);
    if (!target) return;
    target.focus();
    focusNext.current = null;
  }, [editing, batch.id, focusNext]);

  if (!editing) {
    const lotText = batch.plannedLotSizeUnits === undefined ? "not given" : `${fmtCount(batch.plannedLotSizeUnits)} containers`;
    const sizeText =
      batch.batchSize === undefined ? "not given" : batch.batchSizeUnit ? `${fmtCount(batch.batchSize)} ${batch.batchSizeUnit}` : `${fmtCount(batch.batchSize)} (unit not given)`;
    return (
      <div className="batch-summary" role="group" aria-label={`Batch ${batch.id}`} data-testid={`batch-${batch.id}`} ref={rootRef}>
        <dl>
          <div>
            <dt>{batch.id}</dt>
            <dd>
              <strong>{batch.label}</strong>
            </dd>
          </div>
          <div>
            <dt>Planned lot size:</dt>
            <dd data-testid={`batch-lot-text-${batch.id}`}>{lotText}</dd>
          </div>
          <div>
            <dt>Batch size:</dt>
            <dd data-testid={`batch-size-text-${batch.id}`}>{sizeText}</dd>
          </div>
          {batch.notes ? (
            <div>
              <dt>Notes:</dt>
              <dd className="muted">{batch.notes}</dd>
            </div>
          ) : null}
        </dl>
        <div className="batch-actions">
          <button type="button" className="btn" aria-label={`Edit batch ${batch.id}`} data-testid={`batch-edit-${batch.id}`} onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            className="btn danger"
            aria-label={`Remove batch ${batch.id}`}
            onClick={() => run((p, actor) => removeBatch(p, plan.id, batch.id, actor), `Batch ${batch.id} removed`)}
          >
            Remove batch
          </button>
        </div>
      </div>
    );
  }

  return (
    <fieldset className="stack fs" data-testid={`batch-${batch.id}`} ref={rootRef}>
      <legend>{batch.id}</legend>
      <div className="row wrap">
        <label className="field">
          <span>Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} data-testid={`batch-label-${batch.id}`} />
        </label>
        <NumField label="Planned lot size (containers)" value={lot} onChange={(v) => setLot(v === undefined ? undefined : Math.trunc(v))} testId={`batch-lot-${batch.id}`} />
        <NumField label="Batch size (optional)" value={size} onChange={setSize} testId={`batch-size-${batch.id}`} />
        <label className="field">
          <span>Batch size unit</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. L" data-testid={`batch-unit-${batch.id}`} />
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
          // A just-added batch can be saved as it is (label only) to close the row; a saved one needs a change.
          disabled={(!dirty && !isNew) || !label.trim()}
          data-testid={`batch-save-${batch.id}`}
          onClick={() => {
            const ok = run(
              (p, actor) => updateBatch(p, plan.id, batch.id, { label: label.trim(), plannedLotSizeUnits: lot, batchSize: size === undefined || size <= 0 ? undefined : size, batchSizeUnit: unit.trim() || undefined, notes: notes.trim() || undefined }, actor),
              `Batch ${batch.id} saved`,
            );
            if (ok) onClose();
          }}
        >
          Save batch
        </button>
        {isNew ? null : (
          <button type="button" className="btn" data-testid={`batch-cancel-${batch.id}`} onClick={onClose}>
            Cancel
          </button>
        )}
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
                        {SUGGESTION_SOURCE_LABEL[s.source]}; {TYPE_LABEL[s.type]}
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
