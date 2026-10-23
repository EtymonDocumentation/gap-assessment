import { addTrdItem, addTrdStep, catalogInsertIndex, checkLimits, effectiveField, moveTrdStep, removeTrdItem, removeTrdStep, updateTrdStep } from "@gap/engine";
import { COLLECTION_LABELS, type SeedCollection, type TrdDocument, type TrdItem, type TrdStep } from "@gap/process-model";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../components";
import { useContent, useStore } from "../store";
import type { Run } from "./SamplingFlow";
import { FieldRow, FieldTags } from "./TrdFieldRow";
import { LimitsEditor, LimitsSummary } from "./TrdLimits";

/** The filters of the process view. A filter only hides items from the view; it never changes the TRD. */
export type TrdFilter = "all" | "overridden" | "problem" | "not_established" | "tbd";
export const TRD_FILTERS: { id: TrdFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "overridden", label: "Overridden" },
  { id: "problem", label: "Has a PAR/NOR problem" },
  { id: "not_established", label: "Not established" },
  { id: "tbd", label: "TBD" },
];

const COLLECTIONS: SeedCollection[] = ["param", "equip", "mat", "ipc", "study", "doc"];
const LIMIT_COLLECTIONS: SeedCollection[] = ["param", "ipc"];

export function itemMatches(item: TrdItem, filter: TrdFilter): boolean {
  if (filter === "all") return true;
  const values = item.fields.map((f) => ({ f, v: effectiveField(f) }));
  if (filter === "overridden") return values.some((x) => x.v.overridden);
  if (filter === "not_established") return values.some((x) => x.v.status === "not_established");
  if (filter === "tbd") return values.some((x) => x.v.status === "tbd");
  return checkLimits(item.limits).findings.some((x) => x.level === "problem");
}

/** A step passes the filter if its own fields or any item pass; it is then shown with only the items that pass. */
export function stepMatches(step: TrdStep, filter: TrdFilter): boolean {
  if (filter === "all") return true;
  const own = step.fields.map((f) => effectiveField(f));
  const ownHit = filter === "overridden" ? own.some((v) => v.overridden) : filter === "not_established" ? own.some((v) => v.status === "not_established") : filter === "tbd" ? own.some((v) => v.status === "tbd") : false;
  return ownHit || step.items.some((i) => itemMatches(i, filter));
}

/** Which steps the person opened or closed, kept while the session lasts (switching tabs or pages must not fold everything again). */
const OPENED = new Map<string, Record<string, boolean>>();

/** "12 parameters, 2 overridden, 1 PAR/NOR problem ..." for a step, in words; zero counts are left out except the parameters. */
export function stepSummary(s: TrdStep): string {
  const fields = [...s.fields, ...s.items.flatMap((i) => i.fields)].map((f) => effectiveField(f));
  const params = s.items.filter((i) => i.collection === "param").length;
  const problems = s.items.filter((i) => itemMatches(i, "problem")).length;
  const n = (count: number, one: string, many = one) => (count > 0 ? [`${count} ${count === 1 ? one : many}`] : []);
  return [
    `${params} ${params === 1 ? "parameter" : "parameters"}`,
    ...n(s.items.length - params, "other item", "other items"),
    ...n(fields.filter((v) => v.overridden).length, "overridden"),
    ...n(problems, "PAR/NOR problem", "PAR/NOR problems"),
    ...n(fields.filter((v) => v.status === "not_established").length, "not established"),
    ...n(fields.filter((v) => v.status === "tbd").length, "TBD"),
  ].join(", ");
}

export function TrdSteps({ d, run }: { d: TrdDocument; run: Run }) {
  const content = useContent();
  const [filter, setFilter] = useState<TrdFilter>("all");
  const [explicit, setExplicitState] = useState<Record<string, boolean>>(() => OPENED.get(d.id) ?? {});
  const setExplicit = (next: Record<string, boolean>) => {
    OPENED.set(d.id, next);
    setExplicitState(next);
  };
  // A step that is new since the last render (just added) opens, so the person sees what they made.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(d.steps.map((x) => x.id));
    if (known.current) {
      const fresh = [...ids].filter((id) => !known.current!.has(id));
      if (fresh.length) setExplicit({ ...explicit, ...Object.fromEntries(fresh.map((id) => [id, true])) });
    }
    known.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.steps]);
  const isOpen = (id: string) => explicit[id] ?? filter !== "all";
  const [pendingRemove, setPendingRemove] = useState<TrdStep | null>(null);
  const [custom, setCustom] = useState("");
  const [uo, setUo] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  const present = new Set(d.steps.map((s) => s.key).filter(Boolean));
  const free = content.catalog.unitOperations.filter((u) => !present.has(u.key));
  const shown = d.steps.filter((s) => stepMatches(s, filter));

  return (
    <div className="stack-lg" data-testid="trd-process">
      <section className="card stack" aria-labelledby="trd-filter-h">
        <h2 id="trd-filter-h">Process steps ({d.steps.length})</h2>
        <p className="muted small">
          Each step holds the parameters, equipment, materials, in-process controls, studies and documents that came in with it. A value you type over a project value is an override; the project value stays beside it.
        </p>
        <div role="group" aria-label="Filter the process view" className="row wrap seg" data-testid="trd-filters">
          {TRD_FILTERS.map((f) => (
            <button key={f.id} type="button" className={filter === f.id ? "btn primary small" : "btn small"} aria-pressed={filter === f.id} data-testid={`trd-filter-${f.id}`} onClick={() => {
                setFilter(f.id);
                // Choosing a filter hands the open state back to the filter, which opens the steps that have matches.
                if (f.id !== "all") setExplicit({});
              }}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="row wrap">
          <button type="button" className="btn small" data-testid="trd-steps-open-all" onClick={() => setExplicit(Object.fromEntries(d.steps.map((x) => [x.id, true])))}>
            Open all steps
          </button>
          <button type="button" className="btn small" data-testid="trd-steps-close-all" onClick={() => setExplicit(Object.fromEntries(d.steps.map((x) => [x.id, false])))}>
            Close all steps
          </button>
        </div>
        {filter !== "all" && (
          <p className="small" role="status" data-testid="trd-filter-note">
            Showing {shown.length} of {d.steps.length} steps. A filter only hides items from this view.
          </p>
        )}
      </section>

      {d.steps.length === 0 && <p className="notice">This TRD has no process steps yet. Add a catalog step or a custom step below.</p>}

      {shown.map((s) => {
        const i = d.steps.indexOf(s);
        return (
          <StepCard
            key={s.id}
            d={d}
            s={s}
            filter={filter}
            expanded={isOpen(s.id)}
            onToggle={() => setExplicit({ ...explicit, [s.id]: !isOpen(s.id) })}
            onEdited={() => explicit[s.id] !== true && setExplicit({ ...explicit, [s.id]: true })}
            run={run}
            first={i === 0}
            last={i === d.steps.length - 1}
            onRemove={(el) => {
              opener.current = el;
              setPendingRemove(s);
            }}
          />
        );
      })}

      <section className="card stack" aria-labelledby="trd-addstep-h">
        <h2 id="trd-addstep-h">Add a process step</h2>
        <form
          className="row wrap end-align"
          onSubmit={(e) => {
            e.preventDefault();
            const u = content.catalog.unitOperations.find((x) => x.key === uo);
            if (!u) return;
            if (run((p, actor) => addTrdStep(p, d.id, { unitOp: u.key, label: u.label }, actor, catalogInsertIndex(content, d.steps.map((x) => ({ unitOp: x.key })), u.key)).project, `${u.label} added`)) setUo("");
          }}
        >
          <label className="field grow">
            <span>Catalog step</span>
            <select value={uo} onChange={(e) => setUo(e.target.value)} data-testid="trd-step-catalog">
              <option value="">Choose a step</option>
              {free.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn" disabled={!uo} data-testid="trd-step-catalog-add">
            Add step
          </button>
        </form>
        <form
          className="row wrap end-align"
          onSubmit={(e) => {
            e.preventDefault();
            if (!custom.trim()) return;
            if (run((p, actor) => addTrdStep(p, d.id, { label: custom.trim() }, actor).project, "Custom step added")) setCustom("");
          }}
        >
          <label className="field grow">
            <span>Custom step (a step the catalog does not have)</span>
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Intermediate hold (fictional)" data-testid="trd-step-custom-input" />
          </label>
          <button type="submit" className="btn" disabled={!custom.trim()} data-testid="trd-step-custom-add">
            Add custom step
          </button>
        </form>
      </section>

      {pendingRemove && (
        <Modal
          open
          onOpenChange={(o) => !o && setPendingRemove(null)}
          title="Remove this step?"
          description={`${pendingRemove.label} has ${pendingRemove.items.length} items. The change log keeps what the step held.`}
          restoreFocus={() => opener.current}
        >
          <div className="row end">
            <button type="button" className="btn" autoFocus onClick={() => setPendingRemove(null)}>
              Keep the step
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="trd-step-remove-confirm"
              onClick={() => {
                const s = pendingRemove;
                setPendingRemove(null);
                run((p, actor) => removeTrdStep(p, d.id, s.id, actor), `${s.label} removed`);
              }}
            >
              Remove the step
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StepCard({ d, s, filter, expanded, onToggle, onEdited, run: runOuter, first, last, onRemove }: { d: TrdDocument; s: TrdStep; filter: TrdFilter; expanded: boolean; onToggle: () => void; onEdited: () => void; run: Run; first: boolean; last: boolean; onRemove: (el: HTMLElement) => void }) {
  // A change made inside the step keeps it open; moving or removing the step from its header does not use this.
  const run: Run = (fn, status) => {
    const ok = runOuter(fn, status);
    if (ok) onEdited();
    return ok;
  };
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.description ?? "");
  const editBtn = useRef<HTMLButtonElement>(null);
  const focusEdit = useRef(false);
  useEffect(() => {
    if (!editing && focusEdit.current) {
      editBtn.current?.focus();
      focusEdit.current = false;
    }
  }, [editing]);
  const items = s.items.filter((i) => itemMatches(i, filter));

  return (
    <section className="card stack" aria-labelledby={`trd-step-${s.id}-h`} data-testid={`trd-step-${s.id}`}>
      <div className="row between wrap">
        <h2 id={`trd-step-${s.id}-h`}>
          <button type="button" className="trd-step-toggle" aria-expanded={expanded} aria-controls={`trd-step-${s.id}-body`} data-testid={`trd-step-toggle-${s.id}`} onClick={onToggle}>
            <span aria-hidden="true">{expanded ? "\u25BE" : "\u25B8"}</span> {s.label} <span className="muted small">({s.id}{s.entered ? ", added in the TRD" : ""})</span>
          </button>
        </h2>
        <span className="row wrap no-print">
          <button type="button" className="btn small" disabled={first} aria-label={`Move up: ${s.label}`} onClick={() => run((p, actor) => moveTrdStep(p, d.id, s.id, -1, actor), `${s.label} moved earlier`)}>
            Move up
          </button>
          <button type="button" className="btn small" disabled={last} aria-label={`Move down: ${s.label}`} onClick={() => run((p, actor) => moveTrdStep(p, d.id, s.id, 1, actor), `${s.label} moved later`)}>
            Move down
          </button>
          <button type="button" className="btn small danger" aria-label={`Remove: ${s.label}`} data-testid={`trd-step-remove-${s.id}`} onClick={(e) => onRemove(e.currentTarget)}>
            Remove
          </button>
        </span>
      </div>
      <p className="muted small" data-testid={`trd-step-summary-${s.id}`}>
        {stepSummary(s)}
      </p>

      {expanded && (
      <div className="stack" id={`trd-step-${s.id}-body`}>
      {!editing ? (
        <div className="batch-summary" role="group" aria-label={`Description of ${s.label}`}>
          <dl>
            <div>
              <dt>Description:</dt>
              <dd>{s.description?.trim() ? s.description : <span className="muted">not written yet</span>}</dd>
            </div>
          </dl>
          <div className="batch-actions">
            <button
              ref={editBtn}
              type="button"
              className="btn small"
              aria-label={`Edit the description of ${s.label}`}
              data-testid={`trd-step-desc-edit-${s.id}`}
              onClick={() => {
                setText(s.description ?? "");
                setEditing(true);
              }}
            >
              Edit
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <label className="field">
            <span>Description of {s.label} (your own words; the tool does not write it)</span>
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} data-testid={`trd-step-desc-${s.id}`} />
          </label>
          <div className="row wrap">
            <button
              type="button"
              className="btn primary small"
              data-testid={`trd-step-desc-save-${s.id}`}
              onClick={() => {
                if (run((p, actor) => updateTrdStep(p, d.id, s.id, { description: text }, actor), `${s.label}: description saved`)) {
                  focusEdit.current = true;
                  setEditing(false);
                }
              }}
            >
              Save description
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                focusEdit.current = true;
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {s.fields.length > 0 && (
        <ul className="plain-list trd-fields" aria-label={`Answers about ${s.label}`}>
          {s.fields.map((f) => (
            <FieldRow key={f.key} docId={d.id} f={f} addr={{ part: "step", stepId: s.id, field: f.key }} run={run} testId={`trd-field-${s.id}-${f.key}`} />
          ))}
        </ul>
      )}

      {COLLECTIONS.map((c) => {
        const list = items.filter((i) => i.collection === c);
        if (list.length === 0) return null;
        return (
          <div key={c} className="stack">
            <h3>{COLLECTION_LABELS[c]}</h3>
            <div className="stack">
              {list.map((i) => (
                <ItemCard key={`${i.collection}.${i.key}`} d={d} s={s} item={i} run={run} />
              ))}
            </div>
          </div>
        );
      })}
      {filter !== "all" && items.length === 0 && <p className="muted small">No item of this step matches the filter.</p>}

      <AddItem d={d} s={s} run={run} />
      </div>
      )}
    </section>
  );
}

function ItemCard({ d, s, item, run }: { d: TrdDocument; s: TrdStep; item: TrdItem; run: Run }) {
  const project = useStore((st) => st.project)!;
  const [open, setOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const editBtn = useRef<HTMLButtonElement>(null);
  const focusEdit = useRef(false);
  useEffect(() => {
    if (!open && focusEdit.current) {
      editBtn.current?.focus();
      focusEdit.current = false;
    }
  }, [open]);
  const ref = { stepId: s.id, collection: item.collection, key: item.key };
  const tid = `trd-item-${s.id}-${item.collection}-${item.key}`;
  const hasLimits = LIMIT_COLLECTIONS.includes(item.collection);
  const overridden = item.fields.filter((f) => f.override).length;
  const closeAll = () => {
    focusEdit.current = true;
    setLimitsOpen(false);
    setOpen(false);
  };

  return (
    <article className="point-card trd-item" aria-label={`${item.label}`} data-testid={tid}>
      <div className="row between wrap">
        <h4 className="trd-item-title">
          {item.label} {item.entered || item.custom ? <span className="tag tag-custom">Added by the team</span> : null}
        </h4>
        <span className="row wrap">
          {overridden > 0 && <span className="tag tag-override">{overridden} overridden</span>}
          <button
            ref={editBtn}
            type="button"
            className="btn small"
            aria-expanded={open}
            aria-label={`${open ? "Close" : "Edit"} ${item.label}`}
            data-testid={`${tid}-edit`}
            onClick={() => (open ? closeAll() : setOpen(true))}
          >
            {open ? "Close" : "Edit"}
          </button>
        </span>
      </div>

      {/* Collapsed: what the item says now, one line per field, with the badges that matter. */}
      {!open && item.fields.length > 0 && (
        <div className="stack">
          <p className="small">
            <strong>From the project</strong> <span className="muted">(the project's own values; one you overrode shows your value and a badge)</span>
          </p>
          <ul className="plain-list small trd-item-summary">
            {item.fields.map((f) => {
              const v = effectiveField(f);
              return (
                <li key={f.key}>
                  <span className="muted">{f.label}:</span> {v.text} <FieldTags f={f} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {hasLimits && !limitsOpen && <LimitsSummary item={item} sources={project.sources} testId={tid} docId={d.id} itemRef={ref} run={run} />}

      {open && (
        <div className="stack">
          <ul className="plain-list trd-fields" aria-label={`Fields of ${item.label}`}>
            {item.fields.map((f) => (
              <FieldRow key={f.key} docId={d.id} f={f} addr={{ part: "item", ...ref, field: f.key }} run={run} testId={`trd-field-${s.id}-${item.collection}-${item.key}-${f.key}`} />
            ))}
          </ul>
          {hasLimits &&
            (limitsOpen ? (
              <LimitsEditor docId={d.id} item={item} itemRef={ref} run={run} onDone={() => setLimitsOpen(false)} />
            ) : (
              <div>
                <button type="button" className="btn small" data-testid={`${tid}-limits-edit`} onClick={() => setLimitsOpen(true)}>
                  Edit set point, NOR and PAR
                </button>
              </div>
            ))}
          {(item.entered || item.custom) && (
            <div>
              <button
                type="button"
                className="btn small danger"
                aria-label={`Remove ${item.label}`}
                data-testid={`${tid}-remove`}
                onClick={() => run((p, actor) => removeTrdItem(p, d.id, ref, actor), `${item.label} removed`)}
              >
                Remove this item
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function AddItem({ d, s, run }: { d: TrdDocument; s: TrdStep; run: Run }) {
  const [collection, setCollection] = useState<SeedCollection>("param");
  const [label, setLabel] = useState("");
  return (
    <form
      className="row wrap end-align no-print"
      onSubmit={(e) => {
        e.preventDefault();
        if (!label.trim()) return;
        if (run((p, actor) => addTrdItem(p, d.id, s.id, { collection, label: label.trim() }, actor).project, `${label.trim()} added`)) setLabel("");
      }}
    >
      <label className="field">
        <span>Add to {s.label}</span>
        <select value={collection} onChange={(e) => setCollection(e.target.value as SeedCollection)} data-testid={`trd-additem-kind-${s.id}`}>
          {COLLECTIONS.map((c) => (
            <option key={c} value={c}>
              {COLLECTION_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field grow">
        <span>Name</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Hold temperature (fictional)" data-testid={`trd-additem-label-${s.id}`} />
      </label>
      <button type="submit" className="btn small" disabled={!label.trim()} data-testid={`trd-additem-add-${s.id}`}>
        Add
      </button>
    </form>
  );
}
