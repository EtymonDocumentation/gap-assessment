import { mbrLibrary } from "@gap/content";
import { editChangesBlock, editLibraryBlock, newLibraryBlock, type LibraryEdit } from "@gap/engine";
import { MBR_TRD_COLLECTIONS, type MbrLibraryBlock, type MbrLibraryParam, type MbrLibraryTimeLimit } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Empty, Modal } from "../components";
import { dateTime } from "../lib";
import { useMbrBlocks, useMbrLibrary } from "../mbr-blocks-store";
import { href } from "../router";
import { SERVER_MODE } from "../server/mode";
import { actorOf, useContent, useStore } from "../store";

/**
 * The step-blocks library of the master batch record: the blocks a record is built from. The shipped blocks are never changed; an edit
 * is saved as the user's copy of the block with the next version number and the earlier content kept in the history. Records keep their
 * own copy, so an edit here never reaches a record by itself.
 */
export function MbrLibraryPage() {
  const library = useMbrLibrary();
  const items = useMbrBlocks((s) => s.items);
  const ready = useMbrBlocks((s) => s.ready);
  const storeError = useMbrBlocks((s) => s.error);
  const load = useMbrBlocks((s) => s.load);
  const save = useMbrBlocks((s) => s.save);
  const remove = useMbrBlocks((s) => s.remove);
  useEffect(() => void load(), [load]);
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<MbrLibraryBlock | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const editing = library.find((b) => b.id === editId);
  const shippedIds = useMemo(() => new Set(mbrLibrary.map((b) => b.id)), []);
  const mine = new Set(items.map((b) => b.id));

  const statusOf = (b: MbrLibraryBlock) => (shippedIds.has(b.id) ? (mine.has(b.id) ? "Shipped, edited by you" : "Shipped") : "Yours");
  const who = () => {
    const p = useStore.getState().project;
    return p ? actorOf(p).name : "Unnamed user";
  };

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>Step blocks library</h1>
      </PageBanner>
      <p className="no-print">
        <a href={href("/mbr")}>Batch records</a>
      </p>
      <section className="card stack" aria-labelledby="mbl-about">
        <h2 id="mbl-about">What this is</h2>
        <p>The step blocks a master batch record is built from: the steps, the parameter rows that pull a TRD value, the time limits, and what the CMO completes.</p>
        <ul className="plain-list">
          <li>{SERVER_MODE ? "Your edits are kept on the server for your account." : "Your edits are kept in this browser, not in the project file."}</li>
          <li>The shipped blocks are not changed. Editing one saves your copy with the next version number, and the earlier content stays in its history.</li>
          <li>A batch record keeps its own copy of a block and the version it was made from. When the library has a newer version, the record shows "Update from library" and you choose.</li>
          <li>A block names which TRD value a row pulls; it never holds a number of its own.</li>
        </ul>
      </section>

      {storeError && (
        <p className="notice" role="alert" data-testid="mbl-error">
          {storeError}
        </p>
      )}
      <div role="status" aria-live="polite">
        {message && <p data-testid="mbl-message">{message}</p>}
      </div>

      <section className="card stack" aria-labelledby="mbl-list">
        <div className="row between wrap">
          <h2 id="mbl-list">Blocks ({library.length})</h2>
          <button
            type="button"
            className="btn primary"
            data-testid="mbl-new"
            onClick={() => {
              setEditId(null);
              setCreating(true);
              setMessage("");
            }}
          >
            New block
          </button>
        </div>
        {!ready ? (
          <Empty>Loading the blocks.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Step blocks table" tabIndex={0}>
            <table className="data" data-testid="mbl-table">
              <thead>
                <tr>
                  <th scope="col">Block</th>
                  <th scope="col">Version</th>
                  <th scope="col">Source</th>
                  <th scope="col">Steps</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {library.map((b) => (
                  <tr key={b.id} data-testid={`mbl-row-${b.id}`}>
                    <th scope="row">{b.title}</th>
                    <td className="num">{b.version}</td>
                    <td className="small">{statusOf(b)}</td>
                    <td className="num">{b.steps.length}</td>
                    <td>
                      <span className="row wrap">
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`Edit block ${b.title}`}
                          data-testid={`mbl-edit-${b.id}`}
                          onClick={(e) => {
                            opener.current = e.currentTarget;
                            setCreating(false);
                            setEditId(b.id);
                            setMessage("");
                          }}
                        >
                          Edit
                        </button>
                        {mine.has(b.id) && (
                          <button
                            type="button"
                            className="btn small"
                            aria-label={shippedIds.has(b.id) ? `Back to shipped: ${b.title}` : `Remove block ${b.title}`}
                            data-testid={`mbl-remove-${b.id}`}
                            onClick={(e) => {
                              opener.current = e.currentTarget;
                              setConfirm(b);
                            }}
                          >
                            {shippedIds.has(b.id) ? "Back to shipped" : "Remove"}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <BlockForm
          key="new"
          cur={undefined}
          onCancel={() => setCreating(false)}
          onSave={async (edit, id) => {
            await save(newLibraryBlock(id, { title: edit.title ?? "", ...edit }, new Date().toISOString(), who()));
            setCreating(false);
            setMessage(`Block "${edit.title}" added as version 1.`);
          }}
        />
      )}
      {editing && (
        <BlockForm
          key={editing.id}
          cur={editing}
          onCancel={() => {
            setEditId(null);
            setTimeout(() => opener.current?.focus(), 0);
          }}
          onSave={async (edit) => {
            if (!editChangesBlock(editing, edit)) {
              setMessage("Nothing changed, so no new version was made.");
              return;
            }
            const next = editLibraryBlock(editing, edit, new Date().toISOString(), who());
            await save(next);
            setEditId(null);
            setMessage(`Block "${next.title}" saved as version ${next.version}. Records made from an earlier version show "Update from library".`);
            setTimeout(() => opener.current?.focus(), 0);
          }}
        />
      )}

      {confirm && (
        <Modal
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={shippedIds.has(confirm.id) ? "Bring back the shipped version?" : "Remove this block?"}
          description={shippedIds.has(confirm.id) ? `${confirm.title}: your edits (version ${confirm.version}) are removed from the list. Records keep their own copies.` : `${confirm.title}: removed from the library. Records keep their own copies.`}
          restoreFocus={() => opener.current}
        >
          <div className="row end">
            <button type="button" className="btn" autoFocus onClick={() => setConfirm(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="mbl-confirm-remove"
              onClick={async () => {
                const b = confirm;
                setConfirm(null);
                await remove(b.id);
                setMessage(shippedIds.has(b.id) ? `The shipped version of "${b.title}" is back.` : `Block "${b.title}" removed.`);
              }}
            >
              {shippedIds.has(confirm.id) ? "Bring back shipped version" : "Remove"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

type RefRow = MbrLibraryParam | MbrLibraryTimeLimit;

function RefRows({ title, testId, rows, onChange }: { title: string; testId: string; rows: RefRow[]; onChange: (rows: RefRow[]) => void }) {
  const set = (i: number, patch: Partial<RefRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="fs stack" data-testid={testId}>
      <legend>{title}</legend>
      {rows.length === 0 && <p className="muted small">None.</p>}
      {rows.map((r, i) => (
        <div key={i} className="row wrap end-align" data-testid={`${testId}-${i}`}>
          <label className="field grow">
            <span>Label</span>
            <input value={r.label} onChange={(e) => set(i, { label: e.target.value, key: r.key || slug(e.target.value) })} />
          </label>
          <label className="field">
            <span>Kind of TRD item</span>
            <select value={r.collection} onChange={(e) => set(i, { collection: e.target.value as RefRow["collection"] })}>
              {MBR_TRD_COLLECTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>TRD item key</span>
            <input value={r.itemKey} onChange={(e) => set(i, { itemKey: e.target.value })} />
          </label>
          <label className="field">
            <span>Field (setPoint, nor, par or a field key)</span>
            <input value={r.field} onChange={(e) => set(i, { field: e.target.value })} />
          </label>
          <button type="button" className="btn small" aria-label={`Remove ${title.toLowerCase()} row ${r.label || i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="btn small" data-testid={`${testId}-add`} onClick={() => onChange([...rows, { key: "", label: "", collection: "param", itemKey: "", field: "setPoint" }])}>
          Add a row
        </button>
      </div>
    </fieldset>
  );
}

function BlockForm({ cur, onSave, onCancel }: { cur: MbrLibraryBlock | undefined; onSave: (edit: LibraryEdit, id: string) => Promise<void>; onCancel: () => void }) {
  const content = useContent();
  const [title, setTitle] = useState(cur?.title ?? "");
  const [unitOps, setUnitOps] = useState<string[]>(cur?.unitOps ?? []);
  const [steps, setSteps] = useState((cur?.steps ?? []).join("\n"));
  const [params, setParams] = useState<RefRow[]>(cur?.params ?? []);
  const [limits, setLimits] = useState<RefRow[]>(cur?.timeLimits ?? []);
  const [sampleTypes, setSampleTypes] = useState((cur?.sampleTypes ?? []).join("\n"));
  const [cmo, setCmo] = useState((cur?.cmoFields ?? []).join("\n"));
  const [note, setNote] = useState(cur?.note ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  async function submit() {
    if (!title.trim()) return setError("Give the block a title.");
    const bad = [...params, ...limits].find((r) => !r.label.trim() || !r.itemKey.trim() || !r.field.trim());
    if (bad) return setError("Each parameter and time limit row needs a label, a TRD item key and a field.");
    const clean = (rows: RefRow[]) => rows.map((r) => ({ ...r, key: r.key || slug(r.label), label: r.label.trim(), itemKey: r.itemKey.trim(), field: r.field.trim() }));
    const edit: LibraryEdit = { title, unitOps, steps: lines(steps), params: clean(params), timeLimits: clean(limits), sampleTypes: lines(sampleTypes), cmoFields: lines(cmo), note };
    setBusy(true);
    setError("");
    try {
      await onSave(edit, cur?.id ?? (slug(title) || "block"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="mbl-form-h" data-testid="mbl-form">
      <h2 id="mbl-form-h" tabIndex={-1} ref={heading}>
        {cur ? `Edit block: ${cur.title} (now version ${cur.version})` : "New block"}
      </h2>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="mbl-title" />
      </label>
      <fieldset className="fs stack">
        <legend>Offered for these unit operations (none ticked: offered for any)</legend>
        <div className="row wrap">
          {content.catalog.unitOperations.map((u) => (
            <label key={u.key} className="check">
              <input type="checkbox" checked={unitOps.includes(u.key)} onChange={(e) => setUnitOps((s) => (e.target.checked ? [...s, u.key] : s.filter((k) => k !== u.key)))} />
              <span>{u.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span>Steps (one per line; write {"{like this}"} where the author fills something in)</span>
        <textarea rows={8} value={steps} onChange={(e) => setSteps(e.target.value)} data-testid="mbl-steps" />
      </label>
      <RefRows title="Parameter rows" testId="mbl-params" rows={params} onChange={setParams} />
      <RefRows title="Time limits" testId="mbl-limits" rows={limits} onChange={setLimits} />
      <label className="field">
        <span>Sample types (one word or phrase per line, matched against the sampling plan's tests; * for all points of the unit operation)</span>
        <textarea rows={2} value={sampleTypes} onChange={(e) => setSampleTypes(e.target.value)} />
      </label>
      <label className="field">
        <span>To be completed by the CMO (one entry per line)</span>
        <textarea rows={3} value={cmo} onChange={(e) => setCmo(e.target.value)} data-testid="mbl-cmo" />
      </label>
      <label className="field">
        <span>Note for the reader (optional)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {cur && (cur.history?.length ?? 0) > 0 && (
        <div className="stack">
          <button type="button" className="btn small" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)} data-testid="mbl-history-toggle">
            {showHistory ? "Hide" : "Show"} earlier versions ({cur.history!.length})
          </button>
          {showHistory && (
            <ul className="plain-list" data-testid="mbl-history">
              {[...cur.history!].reverse().map((h) => (
                <li key={h.version}>
                  <strong>Version {h.version}</strong>: {h.title}, {h.steps.length} steps{h.at ? `, saved ${dateTime(h.at)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert" data-testid="mbl-form-error">
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} data-testid="mbl-save" onClick={() => void submit()}>
          {cur ? "Save as a new version" : "Save block"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
