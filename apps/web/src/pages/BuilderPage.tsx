import {
  addCustomItem,
  addCustomUnitOperation,
  applyAnswer,
  buildModelView,
  CUSTOM_KIND_LABELS,
  filterModelView,
  removeCustomItem,
  removeCustomUnitOperation,
  renameCustomItem,
  renameCustomUnitOperation,
  setResponder,
  unitDimensions,
  type AnswerInput,
  type AttributeSide,
  type BuilderAttribute,
  type CustomDefinitionRow,
} from "@gap/engine";
import { CUSTOM_ITEM_KINDS, type CustomItemKind } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { CategoryChip, Empty, Modal, ResponderForm } from "../components";
import { useAssessment, useContent, useStore } from "../store";
import { QuestionInput, initialForm, toAnswer, type FormState } from "./question-inputs";

type SideKey = "source" | "target" | "shared";
const SIDE_NAME: Record<SideKey, string> = { source: "Source", target: "Target", shared: "Value" };

interface EditTarget {
  attr: BuilderAttribute;
  sideKey: SideKey;
  cell: AttributeSide;
}

type Dialogs =
  | { kind: "edit"; target: EditTarget }
  | { kind: "add-uo" }
  | { kind: "add-item"; uo?: string }
  | { kind: "rename"; def: CustomDefinitionRow }
  | { kind: "remove"; def: CustomDefinitionRow }
  | null;

const editButtonId = (attrId: string, side: SideKey) => `edit-${attrId}-${side}`;

/** Editable view of the process model: every attribute of every in-scope section, source beside target. */
export function BuilderPage() {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const content = useContent();
  const a = useAssessment()!;
  const view = useMemo(() => buildModelView(content, project, a), [content, project, a]);

  const [text, setText] = useState("");
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const shown = useMemo(() => filterModelView(view, { text, onlyDifferences, onlyOpen }), [view, text, onlyDifferences, onlyOpen]);
  const attrCount = shown.sections.reduce((n, s) => n + s.attributes.length, 0);

  const [dialog, setDialog] = useState<Dialogs>(null);
  const [pendingOpen, setPendingOpen] = useState<Dialogs>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // After a change, move focus to the element that was affected, or to the page heading.
  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(focusId) ?? headingRef.current;
    el?.focus();
    setFocusId(null);
  }, [focusId, project]);

  const needsResponder = !project.interview.responder;
  /** Opens a dialog, asking who is making the change first when no responder is recorded yet. */
  const open = (d: Dialogs) => (needsResponder ? setPendingOpen(d) : setDialog(d));

  const returnFocus = useRef<string | null>(null);
  const restoreFocus = () => (returnFocus.current ? document.getElementById(returnFocus.current) : null) ?? headingRef.current;

  const activeUos = content.catalog.unitOperations;

  return (
    <div className="stack-lg">
      <div>
        <h1 ref={headingRef} tabIndex={-1} id="builder-title">
          Builder
        </h1>
        <p className="muted">
          Every attribute of the process model, source beside target, with its status, sources, verification state and revision. Edit a value in place,
          or add your own unit operations and items. Nothing is filled in by default: every value has a source.
        </p>
      </div>

      <div className="row wrap">
        <button
          type="button"
          id="add-uo-button"
          className="btn primary"
          onClick={() => {
            returnFocus.current = "add-uo-button";
            open({ kind: "add-uo" });
          }}
        >
          Add unit operation
        </button>
        <button
          type="button"
          id="add-item-button"
          className="btn"
          onClick={() => {
            returnFocus.current = "add-item-button";
            open({ kind: "add-item" });
          }}
        >
          Add parameter, equipment, material or control
        </button>
      </div>

      <div className="filters" role="search" aria-label="Filter the builder">
        <label className="field">
          <span>Filter by text or path</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. filter, mixing, uo.compounding" />
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} />
          <span>Only differences</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          <span>Only open items</span>
        </label>
        <p className="small muted filter-count" aria-live="polite" role="status">
          {attrCount} {attrCount === 1 ? "attribute" : "attributes"} shown
        </p>
      </div>

      {shown.sections.length === 0 ? (
        <Empty>No attributes match the filter.</Empty>
      ) : (
        shown.sections.map((s) => {
          const headingId = `sec-${s.section.id}`;
          return (
            <section key={s.section.id} aria-labelledby={headingId} className="stack builder-section">
              <h2 id={headingId} tabIndex={-1}>
                {s.section.title}
                {s.custom && <span className="tag tag-custom">Custom unit operation</span>}
              </h2>
              <div className="table-scroll" role="region" aria-label={`${s.section.title} attributes`} tabIndex={0}>
                <table className="data builder-table">
                  <thead>
                    <tr>
                      <th scope="col">Attribute</th>
                      <th scope="col">Source (validated)</th>
                      <th scope="col">Target (planned)</th>
                      <th scope="col">Comparison</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.attributes.map((attr) => (
                      <tr key={attr.id} className={attr.differs ? "row-diff" : undefined}>
                        <th scope="row" className={attr.depth > 0 ? "indent" : undefined}>
                          {attr.label}
                          {attr.custom && <span className="tag tag-custom">Custom</span>}
                          {attr.open && <span className="tag">Open</span>}
                        </th>
                        {attr.shared ? (
                          <td colSpan={2}>
                            <Cell attr={attr} sideKey="shared" cell={attr.shared} onEdit={(t) => { returnFocus.current = editButtonId(attr.id, "shared"); open({ kind: "edit", target: t }); }} />
                          </td>
                        ) : (
                          <>
                            <td>
                              {attr.source ? (
                                <Cell attr={attr} sideKey="source" cell={attr.source} onEdit={(t) => { returnFocus.current = editButtonId(attr.id, "source"); open({ kind: "edit", target: t }); }} />
                              ) : (
                                <span className="muted">Not asked</span>
                              )}
                            </td>
                            <td>
                              {attr.target ? (
                                <Cell attr={attr} sideKey="target" cell={attr.target} onEdit={(t) => { returnFocus.current = editButtonId(attr.id, "target"); open({ kind: "edit", target: t }); }} />
                              ) : (
                                <span className="muted">Not asked</span>
                              )}
                            </td>
                          </>
                        )}
                        <td>
                          {attr.gaps.length === 0 ? (
                            <span className="muted">—</span>
                          ) : (
                            <span className="chips">
                              {attr.gaps.map((g) => (
                                <CategoryChip key={g.key} category={g.category} compact />
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      <section aria-labelledby="defs-title" className="stack">
        <h2 id="defs-title">Custom definitions</h2>
        {view.definitions.length === 0 ? (
          <Empty>No custom unit operations or items yet.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Custom definitions table" tabIndex={0}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Unit operation</th>
                  <th scope="col">Added by</th>
                  <th scope="col">Recorded values</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {view.definitions.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">
                      {d.label}
                      {d.why && <div className="small muted">{d.why}</div>}
                    </th>
                    <td>{d.typeText}</td>
                    <td>{d.kind === "uo" ? "—" : d.uoLabel}</td>
                    <td className="small">
                      {d.createdBy}, {d.createdAt.slice(0, 10)}
                    </td>
                    <td>{d.recorded}</td>
                    <td>
                      <div className="row wrap">
                        <button
                          type="button"
                          id={`rename-${d.id}`}
                          className="btn small"
                          aria-label={`Rename ${d.label}`}
                          onClick={() => {
                            returnFocus.current = `rename-${d.id}`;
                            open({ kind: "rename", def: d });
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          id={`remove-${d.id}`}
                          className="btn small danger"
                          aria-label={`Remove ${d.label}`}
                          onClick={() => {
                            returnFocus.current = `remove-${d.id}`;
                            open({ kind: "remove", def: d });
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="inactive-title" className="stack">
        <h2 id="inactive-title" tabIndex={-1}>
          Inactive values <span className="tag">{shown.inactive.length}</span>
        </h2>
        <p className="muted small">
          Values that are kept but no longer count: a later answer closed their question, or their custom definition was removed. They are excluded from the
          comparison and the document.
        </p>
        {shown.inactive.length === 0 ? (
          <Empty>No inactive values.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Inactive values table" tabIndex={0}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Where</th>
                  <th scope="col">Attribute</th>
                  <th scope="col">Side</th>
                  <th scope="col">Value</th>
                  <th scope="col">Why inactive</th>
                  <th scope="col">Sources</th>
                  <th scope="col">Verification</th>
                  <th scope="col">Revision</th>
                </tr>
              </thead>
              <tbody>
                {shown.inactive.map((r) => (
                  <tr key={r.ref}>
                    <td>{r.where}</td>
                    <th scope="row">
                      {r.name} <span className="tag">Inactive</span>
                    </th>
                    <td>{SIDE_NAME[r.side]}</td>
                    <td>{r.display}</td>
                    <td className="small">{r.reason}</td>
                    <td className="small">{r.sources.join("; ") || "—"}</td>
                    <td className="small">{r.verification}</td>
                    <td className="small">{r.revision}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={pendingOpen !== null}
        onOpenChange={(o) => !o && setPendingOpen(null)}
        title="Who is making this change?"
        description="The name and role are recorded on every change as its source."
        restoreFocus={restoreFocus}
      >
        <ResponderForm
          submitLabel="Save responder and continue"
          onSubmit={(v) => {
            update((p) => setResponder(p, { name: v.name, ...(v.role ? { role: v.role } : {}) }), "Responder saved");
            const next = pendingOpen;
            setPendingOpen(null);
            setDialog(next);
          }}
        />
      </Modal>

      {dialog?.kind === "edit" && (
        <EditDialog
          target={dialog.target}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onSave={(input) => {
            const err = update((p, actor) => applyAnswer(p, content, dialog.target.cell.inst, input, actor), `${dialog.target.attr.label} saved`);
            if (!err) {
              returnFocus.current = editButtonId(dialog.target.attr.id, dialog.target.sideKey);
              setDialog(null);
            }
            return err;
          }}
        />
      )}

      {dialog?.kind === "add-uo" && (
        <AddUoDialog
          uos={activeUos.map((u) => ({ key: u.key, label: u.label }))}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onAdd={(v) => {
            const err = update((p, actor) => addCustomUnitOperation(p, content, v, actor), `${v.label} added`);
            if (!err) {
              const key = useStore.getState().project!.custom.unitOperations.at(-1)!.key;
              returnFocus.current = `sec-uo.${key}`;
              setDialog(null);
              setFocusId(`sec-uo.${key}`);
            }
            return err;
          }}
        />
      )}

      {dialog?.kind === "add-item" && (
        <AddItemDialog
          uos={activeUos.map((u) => ({ key: u.key, label: u.label }))}
          initialUo={dialog.uo}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onAdd={(v) => {
            const err = update((p, actor) => addCustomItem(p, content, v, actor), `${v.label} added`);
            if (!err) {
              returnFocus.current = "add-item-button";
              setDialog(null);
            }
            return err;
          }}
        />
      )}

      {dialog?.kind === "rename" && (
        <RenameDialog
          def={dialog.def}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onRename={(label) => {
            const d = dialog.def;
            const err = update(
              (p, actor) =>
                d.kind === "uo"
                  ? renameCustomUnitOperation(p, d.key, label, actor)
                  : renameCustomItem(p, { uo: d.uo, coll: d.coll!, key: d.key }, label, actor),
              `Renamed to ${label}`,
            );
            if (!err) setDialog(null);
            return err;
          }}
        />
      )}

      {dialog?.kind === "remove" && (
        <Modal
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={`Remove ${dialog.def.label}?`}
          description="This removes the definition, not the recorded values."
          restoreFocus={() => document.getElementById("inactive-title") ?? headingRef.current}
        >
          <div className="stack">
            <p>
              {dialog.def.recorded === 0
                ? "No values have been recorded for it yet."
                : `${dialog.def.recorded} recorded ${dialog.def.recorded === 1 ? "value becomes" : "values become"} inactive.`}{" "}
              Inactive values are kept and listed under Inactive values, but they are excluded from the comparison, the gap register and the document.
              {dialog.def.kind === "uo" && " Custom items of this unit operation are removed too, with the same effect on their values."}
            </p>
            <div className="row end">
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  const d = dialog.def;
                  const err = update(
                    (p, actor) => (d.kind === "uo" ? removeCustomUnitOperation(p, d.key, actor) : removeCustomItem(p, { uo: d.uo, coll: d.coll!, key: d.key }, actor)),
                    `${d.label} removed`,
                  );
                  if (!err) {
                    setDialog(null);
                    setFocusId("inactive-title");
                  }
                }}
              >
                Remove and keep values as inactive
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Cell({ attr, sideKey, cell, onEdit }: { attr: BuilderAttribute; sideKey: SideKey; cell: AttributeSide; onEdit: (t: EditTarget) => void }) {
  const statusClass = `status-${cell.status}`;
  return (
    <div className="b-cell">
      <div className="b-value">{cell.display}</div>
      <div className="small">
        <span className={`tag status ${statusClass}`}>{cell.statusText}</span>
        <span className="muted"> Revision {cell.revision}</span>
      </div>
      <div className="small muted">Sources: {cell.sources.join("; ") || "none"}</div>
      <div className="small muted">{cell.verification}</div>
      <button
        type="button"
        id={editButtonId(attr.id, sideKey)}
        className="btn small"
        aria-label={`Edit ${attr.label}${sideKey === "shared" ? "" : `, ${SIDE_NAME[sideKey].toLowerCase()}`}`}
        onClick={() => onEdit({ attr, sideKey, cell })}
      >
        Edit
      </button>
    </div>
  );
}

function EditDialog({
  target,
  onSave,
  onClose,
  restoreFocus,
}: {
  target: EditTarget;
  onSave: (input: AnswerInput) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const inst = target.cell.inst;
  const q = inst.question;
  const side = inst.side;
  const [form, setForm] = useState<FormState>(() => initialForm(content, project, inst));
  const [error, setError] = useState("");
  const [naOpen, setNaOpen] = useState(false);
  const [naText, setNaText] = useState("");
  const sameAllowed = side === "target" && q.sides === "paired" && q.sameAsSource !== false;
  const submit = (input: AnswerInput) => setError(onSave(input) ?? "");

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit: ${target.attr.label}`}
      description={`${SIDE_NAME[side]}${side === "shared" ? "" : " side"} · ${inst.section.title}`}
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const r = toAnswer(q, form);
          if ("error" in r) setError(r.error);
          else submit(r.input);
        }}
      >
        <p className="small">{q.prompt}</p>
        {q.why && <p className="small muted">Why it is asked: {q.why}</p>}
        <QuestionInput q={q} side={side} form={form} setForm={setForm} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row wrap">
          <button type="submit" className="btn primary">
            Save value
          </button>
          <button type="button" className="btn" onClick={() => submit({ kind: "unknown" })}>
            Mark unknown
          </button>
          {sameAllowed && (
            <button type="button" className="btn" onClick={() => submit({ kind: "same_as_source" })}>
              Same as source
            </button>
          )}
          <button type="button" className="btn ghost" aria-expanded={naOpen} onClick={() => setNaOpen((o) => !o)}>
            Not applicable…
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        {naOpen && (
          <div className="na-box">
            <label className="field">
              <span>Why does this not apply? (required)</span>
              <textarea value={naText} onChange={(e) => setNaText(e.target.value)} rows={2} />
            </label>
            <button type="button" className="btn" onClick={() => submit({ kind: "not_applicable", justification: naText })}>
              Record as not applicable
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}

function AddUoDialog({
  uos,
  onAdd,
  onClose,
  restoreFocus,
}: {
  uos: { key: string; label: string }[];
  onAdd: (v: { label: string; description?: string; after?: string }) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [after, setAfter] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add a unit operation"
      description="A custom unit operation gets its own section with a presence question. Add its parameters, equipment, materials and controls afterwards."
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setError(onAdd({ label, ...(description.trim() ? { description: description.trim() } : {}), ...(after ? { after } : {}) }) ?? "");
        }}
      >
        <label className="field">
          <span>Name</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Position</span>
          <select value={after} onChange={(e) => setAfter(e.target.value)}>
            <option value="">At the end</option>
            {uos.map((u) => (
              <option key={u.key} value={u.key}>
                After {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            Description <span className="muted">(optional, shown as the reason for asking)</span>
          </span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Add unit operation
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddItemDialog({
  uos,
  initialUo,
  onAdd,
  onClose,
  restoreFocus,
}: {
  uos: { key: string; label: string }[];
  initialUo?: string;
  onAdd: (v: { uo: string; coll: CustomItemKind; label: string; dimension?: string; why?: string }) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const dims = useMemo(() => unitDimensions(), []);
  const [uo, setUo] = useState(initialUo ?? uos[0]?.key ?? "");
  const [coll, setColl] = useState<CustomItemKind>("param");
  const [label, setLabel] = useState("");
  const [dimension, setDimension] = useState("");
  const [why, setWhy] = useState("");
  const [error, setError] = useState("");
  const hasDim = coll === "param" || coll === "equip";
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add a parameter, equipment, material or control"
      description="The item is asked on both the source and the target side and compared like a built-in item."
      restoreFocus={restoreFocus}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setError(
            onAdd({
              uo,
              coll,
              label,
              ...(hasDim && dimension ? { dimension } : {}),
              ...(why.trim() ? { why: why.trim() } : {}),
            }) ?? "",
          );
        }}
      >
        <label className="field">
          <span>Unit operation</span>
          <select value={uo} onChange={(e) => setUo(e.target.value)}>
            {uos.map((u) => (
              <option key={u.key} value={u.key}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Kind</span>
          <select value={coll} onChange={(e) => setColl(e.target.value as CustomItemKind)}>
            {CUSTOM_ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {CUSTOM_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Name</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </label>
        {hasDim && (
          <label className="field">
            <span>{coll === "param" ? "Unit dimension" : "Capacity unit dimension (optional)"}</span>
            <select value={dimension} onChange={(e) => setDimension(e.target.value)}>
              <option value="">{coll === "param" ? "Choose a dimension" : "No capacity question"}</option>
              {dims.map((d) => (
                <option key={d.dimension} value={d.dimension}>
                  {d.label} ({d.units.join(", ")})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>
            Why is this asked? <span className="muted">(optional)</span>
          </span>
          <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Add item
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RenameDialog({
  def,
  onRename,
  onClose,
  restoreFocus,
}: {
  def: CustomDefinitionRow;
  onRename: (label: string) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const [label, setLabel] = useState(def.label);
  const [error, setError] = useState("");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Rename ${def.label}`} description="The key and all recorded values stay the same." restoreFocus={restoreFocus}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setError(onRename(label) ?? "");
        }}
      >
        <label className="field">
          <span>New name</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Rename
          </button>
        </div>
      </form>
    </Modal>
  );
}
