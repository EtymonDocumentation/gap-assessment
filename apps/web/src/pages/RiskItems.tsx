import { addItem, addItemFromGap, addItemFromSuggestion, evaluateItem, gapSeeds, openActions, suggestFailureModes, thresholdReading, usesTr44 } from "@gap/engine";
import { failureModes } from "@gap/content";
import type { RiskAssessment, RiskItem } from "@gap/process-model";
import { describeAnswers, heatCounts } from "@gap/risk";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../components";

/** Text for the threshold comparison. The flag and the words travel together, so colour is never the only cue. */
export function thresholdText(above: boolean | undefined, t: number | undefined): string {
  if (above === undefined) return t === undefined ? "No action threshold entered yet" : "Not compared";
  return above ? `⚑ Above the action threshold (${t})` : `Not above the action threshold (${t})`;
}

const acceptedText = (v: "yes" | "no" | undefined): string => (v === "yes" ? "Yes" : v === "no" ? "No" : "Not answered");
import { href } from "../router";
import { useSamplingAllowed } from "../risk-module";
import { useContent, useStore } from "../store";
import { RiskItemForm } from "./RiskItemForm";
import { ScoreBadge } from "./RiskScore";
import { RiskSteps } from "./RiskSteps";
import type { Run } from "./SamplingFlow";

/*
 * Step 2 of a risk assessment: the items (failure modes).
 *
 * Design notes (the why):
 *  - SAME PATTERN AS THE SAMPLING PLAN (M7.2). A short add form (step + what can go wrong), with the rest under "More details"; item
 *    cards that are collapsed to a one-line summary with Edit; a by-step view and a table view of the same data.
 *  - NOTHING IS ADDED BY ITSELF. Gaps and catalog suggestions are offers; a person ticks or clicks. An added item has no score: it is
 *    "Not scored" and an open item until the team scores it.
 *  - The gap severity is shown next to a gap offer as reference text only. It is never copied into a score.
 *  - Sorting and filtering change only what is shown, never the order the document lists the items in.
 */

type View = "steps" | "table";
type Filter = "all" | "not-scored" | "open-action" | "residual";
type Sort = "process" | "id" | "score" | "band";

const FILTER_LABEL: Record<Filter, string> = { all: "All items", "not-scored": "Not scored", "open-action": "Has an open action", residual: "Has a residual score" };
const SORT_LABEL: Record<Sort, string> = { process: "Process step order", id: "Item number", score: "Score (highest first)", band: "Band or level (your labels, A to Z)" };

export function RiskItems({ a, run }: { a: RiskAssessment; run: Run }) {
  const [view, setView] = useState<View>("steps");
  const [editing, setEditing] = useState<string | null>(null);
  const focusBack = useRef<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const evals = useMemo(() => new Map(a.items.map((i) => [i.id, evaluateItem(a, i)])), [a]);

  // Focus returns to the Edit button of the item that was open; opening puts focus on the first field.
  useEffect(() => {
    if (editing === null && focusBack.current) {
      document.querySelector<HTMLElement>(`[data-testid="risk-item-edit-${focusBack.current}"]`)?.focus();
      focusBack.current = null;
    }
  }, [editing]);
  const openItem = (id: string) => setEditing(id);
  const closeItem = () => {
    focusBack.current = editing;
    setEditing(null);
  };

  return (
    <>
      <RiskSteps a={a} run={run} />
      <AddItems a={a} run={run} onOpen={openItem} />
      {a.config?.method === "matrix" && <Heat a={a} />}

      <section className="card stack" aria-labelledby="ri-list" data-testid="risk-items">
        <div className="row between wrap">
          <h2 id="ri-list">Items ({a.items.length})</h2>
          <div role="group" aria-label="View of the items" className="row wrap seg no-print">
            <button type="button" className={view === "steps" ? "btn primary" : "btn"} aria-pressed={view === "steps"} onClick={() => setView("steps")} data-testid="risk-view-steps">
              By process step
            </button>
            <button type="button" className={view === "table" ? "btn primary" : "btn"} aria-pressed={view === "table"} onClick={() => setView("table")} data-testid="risk-view-table">
              Register table
            </button>
          </div>
        </div>
        {a.items.length === 0 ? (
          <p className="muted" data-testid="risk-items-empty">
            No items yet. Add one above: from a gap, from a suggestion, or by hand.
          </p>
        ) : view === "steps" ? (
          <ByStep a={a} evals={evals} editing={editing} run={run} onEdit={openItem} onClose={closeItem} />
        ) : (
          <Register a={a} evals={evals} onEdit={(id, el) => {
            opener.current = el;
            openItem(id);
          }} />
        )}
      </section>

      {view === "table" && editing && a.items.find((i) => i.id === editing) && (
        <Modal
          open
          onOpenChange={(o) => !o && closeItem()}
          title={`Edit ${editing}`}
          description="Changes are saved with Save. The change log keeps what the item said before."
          restoreFocus={() => opener.current}
        >
          <RiskItemForm a={a} item={a.items.find((i) => i.id === editing)!} run={run} onDone={closeItem} onCancel={closeItem} />
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ adding

function AddItems({ a, run, onOpen }: { a: RiskAssessment; run: Run; onOpen: (id: string) => void }) {
  const content = useContent();
  const project = useStore((s) => s.project)!;
  const [stepId, setStepId] = useState("");
  const [mode, setMode] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const seeds = useMemo(() => gapSeeds(content, project, a), [content, project, a]);
  const offers = useMemo(() => suggestFailureModes(failureModes, a), [a]);
  const hiddenSteps = failureModes.suggestions.length > 0 && offers.length === 0 && a.steps.length > 0;

  function add(openDetails: boolean) {
    let id = "";
    const ok = run((p, actor) => {
      const r = addItem(p, a.id, { ...(stepId ? { stepId } : {}), failureMode: mode, origin: { kind: "free" } }, actor);
      id = r.itemId;
      return r.project;
    }, "Item added");
    if (!ok) return;
    setMode("");
    if (openDetails) onOpen(id);
  }

  function addTicked() {
    const chosen = seeds.filter((s) => ticked.includes(s.gapId) && s.itemIds.length === 0);
    if (!chosen.length) return;
    const ok = run((p, actor) => chosen.reduce((proj, s) => addItemFromGap(proj, a.id, s, actor).project, p), `${chosen.length} ${chosen.length === 1 ? "item" : "items"} added from gaps`);
    if (ok) setTicked([]);
  }

  return (
    <section className="card stack" aria-labelledby="ri-add" data-testid="risk-add">
      <h2 id="ri-add">Add an item</h2>
      <form
        className="row wrap end-align"
        onSubmit={(e) => {
          e.preventDefault();
          add(false);
        }}
      >
        <label className="field">
          <span>Process step</span>
          <select value={stepId} onChange={(e) => setStepId(e.target.value)} data-testid="risk-add-step">
            <option value="">Not placed on a step</option>
            {a.steps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>What can go wrong (failure mode)</span>
          <input value={mode} onChange={(e) => setMode(e.target.value)} placeholder="e.g. Filter damaged during set-up (fictional)" data-testid="risk-add-mode" />
        </label>
        <button type="submit" className="btn primary" data-testid="risk-add-submit">
          Add item
        </button>
        <button type="button" className="btn" data-testid="risk-add-more" onClick={() => add(true)}>
          Add and open More details
        </button>
      </form>
      <p className="muted small">Effect, causes, controls, the score and the links are under "More details" (Edit) after the item is added. A new item has no score.</p>

      <details data-testid="risk-from-gaps">
        <summary>
          <strong>Add from gaps ({seeds.length})</strong>
        </summary>
        <div className="stack">
          <p className="muted small">The differences found in the gap assessment. Ticked gaps become draft items with the gap text in their notes. The gap severity is shown for reference only; it is never copied into a risk score.</p>
          {seeds.length === 0 ? (
            <p className="muted">No gaps in the project yet.</p>
          ) : (
            <ul className="plain-list">
              {seeds.map((s) => {
                const done = s.itemIds.length > 0;
                return (
                  <li key={s.gapId}>
                    <label className="check">
                      <input type="checkbox" disabled={done} checked={done || ticked.includes(s.gapId)} data-testid={`risk-gap-${s.gapId}`} onChange={(e) => setTicked(e.target.checked ? [...ticked, s.gapId] : ticked.filter((x) => x !== s.gapId))} />{" "}
                      <span>
                        <strong>{s.gapId}</strong>: {s.attribute}. SU: {s.su}. RU: {s.ru}. <span className="muted">Gap severity (reference only): {s.severity}.</span>
                        {done ? ` Already item ${s.itemIds.join(", ")}.` : ""}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div>
            <button type="button" className="btn" disabled={!ticked.length} onClick={addTicked} data-testid="risk-gaps-add">
              Add ticked gaps as items
            </button>
          </div>
        </div>
      </details>

      <details data-testid="risk-suggestions">
        <summary>
          <strong>Typical failure modes for your steps ({offers.length})</strong>
        </summary>
        <div className="stack">
          <p className="muted small">General knowledge about what commonly goes wrong at a step, from the failure-mode catalog (version {failureModes.catalog.version}). Nothing is added unless you add it, and no suggestion carries a score.</p>
          {offers.length === 0 ? (
            <p className="muted">{a.steps.length === 0 || hiddenSteps ? "No suggestions for the steps of this assessment. Add a catalog step and its suggestions appear here." : "No suggestions."}</p>
          ) : (
            a.steps.map((st) => {
              const list = offers.filter((o) => o.stepId === st.id);
              if (!list.length) return null;
              return (
                <div key={st.id} className="stack">
                  <h3>{st.label}</h3>
                  <ul className="plain-list">
                    {list.map((o) => (
                      <li key={o.key} className="point-card">
                        <p>
                          <strong>{o.failureMode}</strong>
                        </p>
                        <p className="small">Effect: {o.effect}</p>
                        <p className="small muted">Why it is typical: {o.rationale}</p>
                        {o.guidanceRef && (
                          <p className="small muted">
                            See the <a href={href("/guidance")}>Guidance library</a> ({o.guidanceRef}).
                          </p>
                        )}
                        <button
                          type="button"
                          className="btn small"
                          disabled={o.added}
                          aria-label={o.added ? `Already added: ${o.failureMode}` : `Add as an item: ${o.failureMode}`}
                          data-testid={`risk-suggest-${o.key}`}
                          onClick={() => run((p, actor) => addItemFromSuggestion(p, a.id, o, failureModes.catalog.version, actor).project, "Item added from a suggestion")}
                        >
                          {o.added ? "Added" : "Add as an item"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      </details>
    </section>
  );
}

// ------------------------------------------------------------------ the by-step view

type Evals = Map<string, ReturnType<typeof evaluateItem>>;

function ByStep({ a, evals, editing, run, onEdit, onClose }: { a: RiskAssessment; evals: Evals; editing: string | null; run: Run; onEdit: (id: string) => void; onClose: () => void }) {
  const groups = [...a.steps.map((s) => ({ id: s.id, label: s.label })), { id: "", label: "Not placed on a step" }];
  return (
    <div className="stack">
      {groups.map((g) => {
        const items = a.items.filter((i) => (i.stepId ?? "") === g.id);
        if (!items.length) return null;
        return (
          <div key={g.id || "none"} className="stack" data-testid={`risk-group-${g.id || "none"}`}>
            <h3>
              {g.label} ({items.length})
            </h3>
            {items.map((i) => (i.id === editing ? <ItemEditing key={i.id} a={a} item={i} run={run} onClose={onClose} /> : <ItemCard key={i.id} a={a} item={i} ev={evals.get(i.id)!} onEdit={() => onEdit(i.id)} />))}
          </div>
        );
      })}
    </div>
  );
}

function ItemEditing({ a, item, run, onClose }: { a: RiskAssessment; item: RiskItem; run: Run; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-testid="item-failure-mode"]')?.focus();
  }, []);
  return (
    <div className="risk-item stack" data-open="true" ref={ref} data-testid={`risk-item-${item.id}`}>
      <h4>Edit {item.id}</h4>
      <RiskItemForm a={a} item={item} run={run} onDone={onClose} onCancel={onClose} />
    </div>
  );
}

/** A collapsed item: one summary with the answers, the score and the links, and an Edit button. */
function ItemCard({ a, item, ev, onEdit }: { a: RiskAssessment; item: RiskItem; ev: ReturnType<typeof evaluateItem>; onEdit: () => void }) {
  const samplingAllowed = useSamplingAllowed();
  const open = openActions(a, item.id).length;
  const total = a.actions.filter((x) => x.itemId === item.id).length;
  return (
    <div className="risk-item" data-testid={`risk-item-${item.id}`}>
      <div className="batch-summary" role="group" aria-label={`${item.id} summary`}>
        <dl>
          <div>
            <dt>{item.id}:</dt>
            <dd>
              <strong>{item.failureMode || "Failure mode not described"}</strong>
            </dd>
          </div>
          <div>
            <dt>Score:</dt>
            <dd>
              <ScoreBadge config={a.config} res={ev.initial} />
              {a.config && item.initial && describeAnswers(a.config, item.initial) ? <span className="muted small"> ({describeAnswers(a.config, item.initial)})</span> : null}
            </dd>
          </div>
          {usesTr44(a) && (
            <div>
              <dt>Threshold:</dt>
              <dd data-testid={`risk-threshold-flag-${item.id}`}>{thresholdText(thresholdReading(a, ev).above, a.actionThreshold)}</dd>
            </div>
          )}
          {usesTr44(a) && (
            <div>
              <dt>Risk accepted?</dt>
              <dd data-testid={`risk-accepted-${item.id}`}>{acceptedText(item.accepted)}</dd>
            </div>
          )}
          {ev.residual && (
            <div>
              <dt>Residual:</dt>
              <dd>
                <ScoreBadge config={a.config} res={ev.residual} />
              </dd>
            </div>
          )}
          <div>
            <dt>Actions:</dt>
            <dd>{total === 0 ? "none" : `${open} open of ${total}`}</dd>
          </div>
          {item.gapIds.length > 0 && (
            <div>
              <dt>Gaps:</dt>
              <dd>{item.gapIds.join(", ")}</dd>
            </div>
          )}
          {samplingAllowed && item.samplingPointIds.length > 0 && (
            <div>
              <dt>Sampling points:</dt>
              <dd>{item.samplingPointIds.join(", ")}</dd>
            </div>
          )}
        </dl>
        <div className="batch-actions">
          <button type="button" className="btn" aria-label={`Edit ${item.id}`} data-testid={`risk-item-edit-${item.id}`} onClick={onEdit}>
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the register table

function Register({ a, evals, onEdit }: { a: RiskAssessment; evals: Evals; onEdit: (id: string, el: HTMLElement) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("process");
  const stepIndex = new Map(a.steps.map((s, i) => [s.id, i]));
  const stepLabel = (i: RiskItem) => (i.stepId ? (a.steps.find((s) => s.id === i.stepId)?.label ?? i.stepId) : "Not placed on a step");

  const rows = useMemo(() => {
    const list = a.items.filter((i) => {
      const e = evals.get(i.id)!;
      if (filter === "not-scored") return !e.initial.scored;
      if (filter === "open-action") return openActions(a, i.id).length > 0;
      if (filter === "residual") return !!i.residual;
      return true;
    });
    const key = (i: RiskItem) => evals.get(i.id)!.initial;
    return [...list].sort((x, y) => {
      if (sort === "id") return x.id.localeCompare(y.id);
      if (sort === "process") return (x.stepId ? (stepIndex.get(x.stepId) ?? 999) : 1000) - (y.stepId ? (stepIndex.get(y.stepId) ?? 999) : 1000) || x.id.localeCompare(y.id);
      if (sort === "score") {
        // An item that cannot be scored goes last; the order never says it is "lower risk".
        const kx = key(x).sortKey;
        const ky = key(y).sortKey;
        if (kx === undefined && ky === undefined) return x.id.localeCompare(y.id);
        if (kx === undefined) return 1;
        if (ky === undefined) return -1;
        return ky - kx || x.id.localeCompare(y.id);
      }
      const lx = key(x).label;
      const ly = key(y).label;
      if (!lx && !ly) return x.id.localeCompare(y.id);
      if (!lx) return 1;
      if (!ly) return -1;
      return lx.localeCompare(ly) || x.id.localeCompare(y.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, evals, filter, sort]);

  return (
    <div className="stack">
      <div className="row wrap end-align">
        <label className="field">
          <span>Show</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} data-testid="risk-filter">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <option key={f} value={f}>
                {FILTER_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} data-testid="risk-sort">
            {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small" role="status" aria-live="polite" data-testid="risk-register-count">
        Showing {rows.length} of {a.items.length} items. Sorting and filtering change this view only, not the document.
      </p>
      <div className="table-scroll" role="region" aria-label="Risk register table" tabIndex={0}>
        <table className="data points-table" data-testid="risk-register">
          <caption className="visually-hidden">Risk register: item, step, failure mode, score, residual score, open actions</caption>
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Step</th>
              <th scope="col">Failure mode</th>
              <th scope="col">Score</th>
              <th scope="col">Residual</th>
              {usesTr44(a) && <th scope="col">Threshold</th>}
              {usesTr44(a) && <th scope="col">Risk accepted?</th>}
              <th scope="col">Open actions</th>
              <th scope="col">Edit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const e = evals.get(i.id)!;
              return (
                <tr key={i.id} data-testid={`risk-row-${i.id}`}>
                  <th scope="row">{i.id}</th>
                  <td>{stepLabel(i)}</td>
                  <td>{i.failureMode || <span className="muted">Not described</span>}</td>
                  <td>
                    <ScoreBadge config={a.config} res={e.initial} />
                    {a.config && describeAnswers(a.config, i.initial) ? <div className="muted small">{describeAnswers(a.config, i.initial)}</div> : null}
                  </td>
                  <td>{e.residual ? <ScoreBadge config={a.config} res={e.residual} /> : <span className="muted">None entered</span>}</td>
                  {usesTr44(a) && <td>{thresholdText(thresholdReading(a, e).above, a.actionThreshold)}</td>}
                  {usesTr44(a) && <td>{acceptedText(i.accepted)}</td>}
                  <td className="num">{openActions(a, i.id).length}</td>
                  <td>
                    <button type="button" className="btn small" aria-label={`Edit ${i.id}`} data-testid={`risk-row-edit-${i.id}`} onClick={(ev) => onEdit(i.id, ev.currentTarget)}>
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the matrix heat view

/**
 * Counts of items per matrix cell (initial scores). It is a table, so a screen reader gets the same facts: each cell says how many
 * items it holds, names them, and shows the user's own label. Cells with items have a heavy border as well as the count.
 */
function Heat({ a }: { a: RiskAssessment }) {
  const cfg = a.config;
  if (!cfg || cfg.method !== "matrix") return null;
  const heat = heatCounts(cfg, a.items.map((i) => i.initial));
  const idsIn = (r: number, c: number) => a.items.filter((i) => i.initial.values.likelihood === r + 1 && i.initial.values.severity === c + 1 && heatCounts(cfg, [i.initial]).placed === 1).map((i) => i.id);
  return (
    <section className="card stack" aria-labelledby="ri-heat" data-testid="risk-heat">
      <h2 id="ri-heat">Items per matrix cell</h2>
      <p className="muted small">
        {heat.placed} {heat.placed === 1 ? "item is" : "items are"} placed (initial scores); {heat.notScored} not scored and cannot be placed. The label in each cell is your own wording; the tool does not call any cell acceptable or not.
      </p>
      <div className="table-scroll" role="region" aria-label="Items per matrix cell" tabIndex={0}>
        <table className="data risk-heat">
          <caption className="visually-hidden">Number of items in each cell: likelihood in rows, severity in columns</caption>
          <thead>
            <tr>
              <th scope="col">Likelihood \ Severity</th>
              {cfg.severity.map((s) => (
                <th key={s.label} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cfg.likelihood.map((l, r) => (
              <tr key={l.label}>
                <th scope="row">{l.label}</th>
                {cfg.severity.map((s, c) => {
                  const n = heat.counts[r]![c]!;
                  const label = cfg.cells.find((x) => x.row === r + 1 && x.col === c + 1)?.label;
                  return (
                    <td key={s.label} className={n > 0 ? "heat-has" : undefined} data-testid={`heat-${r + 1}-${c + 1}`}>
                      <div className="heat-count">
                        {n} {n === 1 ? "item" : "items"}
                      </div>
                      {n > 0 && <div className="small">{idsIn(r, c).join(", ")}</div>}
                      <div className="small muted">{label || "No label yet"}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
