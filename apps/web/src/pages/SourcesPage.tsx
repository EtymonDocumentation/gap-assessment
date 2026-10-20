import {
  filterSourceRows,
  previewSourceRemoval,
  SOURCE_TYPE_LABELS,
  sourceRegisterRows,
  type SourceRow,
} from "@gap/engine";
import { addSource, removeSource, updateSource, type SourceType } from "@gap/process-model";
import { Fragment, useMemo, useRef, useState } from "react";
import { Empty, Modal } from "../components";
import { href } from "../router";
import { useContent, useStore } from "../store";

type Dialog = { kind: "add" } | { kind: "edit"; row: SourceRow } | { kind: "remove"; row: SourceRow } | null;

/** The register of every source: who said or wrote what, and which entries rely on it. */
export function SourcesPage() {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const content = useContent();
  const rows = useMemo(() => sourceRegisterRows(content, project), [content, project]);

  const [type, setType] = useState<SourceType | "all">("all");
  const [text, setText] = useState("");
  const [onlyUnused, setOnlyUnused] = useState(false);
  const shown = useMemo(() => filterSourceRows(rows, { type, text, onlyUnused }), [rows, type, text, onlyUnused]);
  const types = useMemo(() => [...new Set(rows.map((r) => r.source.type))], [rows]);
  const unused = rows.filter((r) => r.state !== "in_use").length;

  const [dialog, setDialog] = useState<Dialog>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const returnFocus = useRef<string>("add-source-button");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restoreFocus = () => document.getElementById(returnFocus.current) ?? headingRef.current;

  const toggle = (id: string) =>
    setExpanded((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="stack-lg">
      <div>
        <h1 ref={headingRef} tabIndex={-1}>
          Sources
        </h1>
        <p className="muted">
          Every value in the assessment cites at least one source. Removing a source cannot leave a value without one: a value that loses its only source
          becomes Not established, its old value is kept only in the change log, and the gaps are recalculated.
        </p>
      </div>

      <div className="row wrap">
        <button
          type="button"
          id="add-source-button"
          className="btn primary"
          onClick={() => {
            returnFocus.current = "add-source-button";
            setDialog({ kind: "add" });
          }}
        >
          Add document reference
        </button>
        <p className="small muted filter-count">
          {rows.length} {rows.length === 1 ? "source" : "sources"}
          {unused ? `, ${unused} not cited by any entry` : ""}.
        </p>
      </div>

      <div className="filters" role="search" aria-label="Filter the sources">
        <label className="field">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as SourceType | "all")}>
            <option value="all">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {SOURCE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Filter by text</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. PPQ, DEMO-MIX, Alex" />
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyUnused} onChange={(e) => setOnlyUnused(e.target.checked)} />
          <span>Only unused</span>
        </label>
        <p className="small muted filter-count" role="status" aria-live="polite">
          {shown.length} {shown.length === 1 ? "source" : "sources"} shown
        </p>
      </div>

      {shown.length === 0 ? (
        <Empty>No sources match the filter.</Empty>
      ) : (
        <div className="table-scroll" role="region" aria-label="Source register table" tabIndex={0}>
          <table className="data sources-table">
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Source</th>
                <th scope="col">Responder</th>
                <th scope="col">Date</th>
                <th scope="col">Cited by</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const open = expanded.has(r.source.id);
                const editable = r.source.type === "document_reference" || r.source.type === "user_entry";
                return (
                  <Fragment key={r.source.id}>
                    <tr id={`source-${r.source.id}`}>
                      <td>{r.typeLabel}</td>
                      <th scope="row">
                        {r.source.type === "document_reference" ? r.title : r.source.label}
                        {r.state !== "in_use" && <span className={`tag state-${r.state}`}>{r.stateText}</span>}
                        {r.detail && <div className="small muted normal">{r.detail}</div>}
                      </th>
                      <td className="small">{r.responder}</td>
                      <td className="small">{r.date}</td>
                      <td>
                        <button
                          type="button"
                          id={`cites-${r.source.id}`}
                          className="btn small"
                          aria-expanded={open}
                          aria-controls={`cited-${r.source.id}`}
                          aria-label={`${open ? "Hide" : "Show"} ${r.citing.length} ${r.citing.length === 1 ? "entry" : "entries"} citing ${r.source.label}`}
                          onClick={() => toggle(r.source.id)}
                        >
                          {open ? "Hide" : "Show"} {r.citing.length}
                        </button>
                      </td>
                      <td>
                        <div className="row wrap">
                          {editable && (
                            <button
                              type="button"
                              id={`edit-source-${r.source.id}`}
                              className="btn small"
                              aria-label={`Edit ${r.source.label}`}
                              onClick={() => {
                                returnFocus.current = `edit-source-${r.source.id}`;
                                setDialog({ kind: "edit", row: r });
                              }}
                            >
                              Edit
                            </button>
                          )}
                          <button
                            type="button"
                            id={`remove-source-${r.source.id}`}
                            className="btn small danger"
                            aria-label={`Remove ${r.source.label}`}
                            onClick={() => {
                              returnFocus.current = `remove-source-${r.source.id}`;
                              setDialog({ kind: "remove", row: r });
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr id={`cited-${r.source.id}`}>
                        <td colSpan={6}>
                          {r.citing.length === 0 ? (
                            <p className="small muted">No entry cites this source.</p>
                          ) : (
                            <ul className="cite-list">
                              {r.citing.map((c) => (
                                <li key={c.ref}>
                                  {c.question ? (
                                    <a href={href("/builder", { q: c.question.id })}>{c.text}</a>
                                  ) : (
                                    c.text
                                  )}
                                  : {c.display}
                                  {!c.active && <span className="tag">Inactive</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === "add" && (
        <DocRefDialog
          title="Add document reference"
          description="Register a controlled document so entries can cite it."
          submitLabel="Add document reference"
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onSubmit={(v) => {
            const err = update((p, actor) => addSource(p, { type: "document_reference", docRef: v }, actor).project, `${v.identifier} added to the source register`);
            if (!err) setDialog(null);
            return err;
          }}
        />
      )}

      {dialog?.kind === "edit" && (
        <EditSourceDialog
          row={dialog.row}
          restoreFocus={restoreFocus}
          onClose={() => setDialog(null)}
          onSave={(patch) => {
            const err = update((p, actor) => updateSource(p, dialog.row.source.id, patch, actor), `${dialog.row.source.label} updated`);
            if (!err) setDialog(null);
            return err;
          }}
        />
      )}

      {dialog?.kind === "remove" && (
        <RemoveDialog
          row={dialog.row}
          restoreFocus={() => document.getElementById(`remove-source-${dialog.row.source.id}`) ?? document.getElementById("add-source-button") ?? headingRef.current}
          onClose={() => setDialog(null)}
          onRemove={() => {
            let reverted = 0;
            const err = update(
              (p, actor) => {
                const r = removeSource(p, dialog.row.source.id, actor);
                reverted = r.reverted.length;
                return r.project;
              },
              "Source removed",
            );
            if (!err) {
              useStore.setState({
                status: `Source removed. ${reverted} ${reverted === 1 ? "value is" : "values are"} now Not established.`,
              });
              setDialog(null);
            }
            return err;
          }}
        />
      )}
    </div>
  );
}

interface DocRefValue {
  docType: string;
  identifier: string;
  title?: string;
  version?: string;
}

function DocRefDialog({
  title,
  description,
  submitLabel,
  initial,
  onSubmit,
  onClose,
  restoreFocus,
}: {
  title: string;
  description: string;
  submitLabel: string;
  initial?: DocRefValue;
  onSubmit: (v: DocRefValue) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const [docType, setDocType] = useState(initial?.docType ?? "");
  const [identifier, setIdentifier] = useState(initial?.identifier ?? "");
  const [docTitle, setDocTitle] = useState(initial?.title ?? "");
  const [version, setVersion] = useState(initial?.version ?? "");
  const [error, setError] = useState("");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} description={description} restoreFocus={restoreFocus}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setError(onSubmit({ docType, identifier, ...(docTitle.trim() ? { title: docTitle } : {}), ...(version.trim() ? { version } : {}) }) ?? "");
        }}
      >
        <label className="field">
          <span>Document type</span>
          <input value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="e.g. PPQ report" autoFocus />
        </label>
        <label className="field">
          <span>Identifier</span>
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. DEMO-PPQ-217-02" />
        </label>
        <label className="field">
          <span>
            Title <span className="muted">(optional)</span>
          </span>
          <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>
            Version <span className="muted">(optional)</span>
          </span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} />
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
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditSourceDialog({
  row,
  onSave,
  onClose,
  restoreFocus,
}: {
  row: SourceRow;
  onSave: (patch: { label?: string; docType?: string; identifier?: string; title?: string; version?: string }) => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const d = row.source.docRef;
  const [label, setLabel] = useState(row.source.label);
  const [error, setError] = useState("");
  if (d) {
    return (
      <DocRefDialog
        title={`Edit ${d.identifier}`}
        description="Changing the details does not change any value or withdraw any verification. The change is recorded in the change log."
        submitLabel="Save changes"
        initial={d}
        restoreFocus={restoreFocus}
        onClose={onClose}
        onSubmit={(v) => onSave({ docType: v.docType, identifier: v.identifier, title: v.title ?? "", version: v.version ?? "" })}
      />
    );
  }
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Edit note" description="The change is recorded in the change log." restoreFocus={restoreFocus}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setError(onSave({ label }) ?? "");
        }}
      >
        <label className="field">
          <span>Note text</span>
          <textarea value={label} onChange={(e) => setLabel(e.target.value)} rows={3} autoFocus />
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
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RemoveDialog({
  row,
  onRemove,
  onClose,
  restoreFocus,
}: {
  row: SourceRow;
  onRemove: () => string | null;
  onClose: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const preview = useMemo(() => previewSourceRemoval(content, project, row.source.id), [content, project, row.source.id]);
  const [error, setError] = useState("");
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={`Remove ${row.source.label}?`}
      description="Nothing is removed until you confirm. This is what will happen."
      restoreFocus={restoreFocus}
    >
      <div className="stack">
        <ul className="impact" aria-label="Consequences of removing this source">
          {preview.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {preview.reverting.length > 0 && (
          <section aria-labelledby="revert-title" className="stack">
            <h3 id="revert-title">Values that become Not established ({preview.reverting.length})</h3>
            <ul className="plan-list">
              {preview.reverting.map((i) => (
                <li key={i.ref}>
                  {i.label.text}: {i.display}
                  {i.verified ? " (verified)" : ""}
                  {i.active ? "" : " (inactive)"}
                </li>
              ))}
            </ul>
          </section>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={() => setError(onRemove() ?? "")}>
            Remove source
          </button>
        </div>
      </div>
    </Modal>
  );
}
