import { addAction, removeAction, updateAction } from "@gap/engine";
import { RISK_ACTION_STATUSES, type RiskAction, type RiskActionStatus, type RiskAssessment } from "@gap/process-model";
import { useEffect, useRef, useState } from "react";
import type { Run } from "./SamplingFlow";

/*
 * Step 3 of a risk assessment: the actions that follow from the items (ICH Q9(R1) "risk control").
 *
 * An owner and a due date are optional. An action without them is allowed and says "Not given": the tool never names an owner or
 * proposes a date. A status is always one of four words, so it is never colour alone.
 */

export const ACTION_STATUS_LABEL: Record<RiskActionStatus, string> = { open: "Open", in_progress: "In progress", done: "Done", dropped: "Dropped" };

export function RiskActions({ a, run }: { a: RiskAssessment; run: Run }) {
  const [itemId, setItemId] = useState("");
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const focusBack = useRef<string | null>(null);
  useEffect(() => {
    if (editing === null && focusBack.current) {
      document.querySelector<HTMLElement>(`[data-testid="action-edit-${focusBack.current}"]`)?.focus();
      focusBack.current = null;
    }
  }, [editing]);

  function add() {
    if (!itemId || !text.trim()) return;
    const ok = run((p, actor) => addAction(p, a.id, { itemId, text, owner, due }, actor).project, "Action added");
    if (ok) {
      setText("");
      setOwner("");
      setDue("");
    }
  }

  return (
    <section className="card stack" aria-labelledby="ra-actions" data-testid="risk-actions">
      <h2 id="ra-actions">Actions ({a.actions.length})</h2>
      {a.items.length === 0 ? (
        <p className="muted">Add an item first; an action belongs to an item.</p>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="row wrap end-align">
            <label className="field">
              <span>For item</span>
              <select value={itemId} onChange={(e) => setItemId(e.target.value)} data-testid="action-item">
                <option value="">Choose an item</option>
                {a.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id}: {i.failureMode || "failure mode not described"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field grow">
              <span>Action</span>
              <input value={text} onChange={(e) => setText(e.target.value)} data-testid="action-text" />
            </label>
          </div>
          <div className="row wrap end-align">
            <label className="field">
              <span>
                Owner <span className="muted">(optional)</span>
              </span>
              <input value={owner} onChange={(e) => setOwner(e.target.value)} data-testid="action-owner" />
            </label>
            <label className="field">
              <span>
                Due date <span className="muted">(optional)</span>
              </span>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} data-testid="action-due" />
            </label>
            <button type="submit" className="btn primary" disabled={!itemId || !text.trim()} data-testid="action-add">
              Add action
            </button>
          </div>
        </form>
      )}

      {a.actions.length === 0 ? (
        <p className="muted" data-testid="risk-actions-empty">
          No actions yet.
        </p>
      ) : (
        <ul className="plain-list stack" data-testid="risk-action-list">
          {a.actions.map((x) =>
            editing === x.id ? (
              <ActionEditor
                key={x.id}
                a={a}
                action={x}
                run={run}
                onClose={() => {
                  focusBack.current = x.id;
                  setEditing(null);
                }}
              />
            ) : (
              <li key={x.id} className="risk-item" data-testid={`action-${x.id}`}>
                <div className="batch-summary" role="group" aria-label={`${x.id} summary`}>
                  <dl>
                    <div>
                      <dt>{x.id}:</dt>
                      <dd>
                        <strong>{x.text}</strong>
                      </dd>
                    </div>
                    <div>
                      <dt>Item:</dt>
                      <dd>{x.itemId}</dd>
                    </div>
                    <div>
                      <dt>Owner:</dt>
                      <dd>{x.owner ?? "Not given"}</dd>
                    </div>
                    <div>
                      <dt>Due:</dt>
                      <dd>{x.due ?? "Not given"}</dd>
                    </div>
                    <div>
                      <dt>Status:</dt>
                      <dd>{ACTION_STATUS_LABEL[x.status]}</dd>
                    </div>
                  </dl>
                  <div className="batch-actions">
                    <button type="button" className="btn" aria-label={`Edit ${x.id}`} data-testid={`action-edit-${x.id}`} onClick={() => setEditing(x.id)}>
                      Edit
                    </button>
                  </div>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function ActionEditor({ a, action, run, onClose }: { a: RiskAssessment; action: RiskAction; run: Run; onClose: () => void }) {
  const [text, setText] = useState(action.text);
  const [owner, setOwner] = useState(action.owner ?? "");
  const [due, setDue] = useState(action.due ?? "");
  const [status, setStatus] = useState<RiskActionStatus>(action.status);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <li className="risk-item stack" data-open="true" data-testid={`action-form-${action.id}`}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (run((p, actor) => updateAction(p, a.id, action.id, { text, owner, due, status }, actor), `${action.id} saved`)) onClose();
        }}
      >
        <h4>Edit {action.id}</h4>
        <label className="field">
          <span>Action</span>
          <input ref={first} value={text} onChange={(e) => setText(e.target.value)} data-testid="action-edit-text" />
        </label>
        <div className="row wrap end-align">
          <label className="field">
            <span>Owner (optional)</span>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} />
          </label>
          <label className="field">
            <span>Due date (optional)</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as RiskActionStatus)} data-testid="action-edit-status">
              {RISK_ACTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ACTION_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row wrap">
          <button type="submit" className="btn primary" disabled={!text.trim()} data-testid="action-save">
            Save {action.id}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn danger"
            data-testid="action-remove"
            onClick={() => {
              if (run((p, actor) => removeAction(p, a.id, action.id, actor), `${action.id} removed`)) onClose();
            }}
          >
            Remove action
          </button>
        </div>
      </form>
    </li>
  );
}
