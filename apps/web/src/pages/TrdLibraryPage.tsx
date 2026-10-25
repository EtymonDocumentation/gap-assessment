import { trdWriteups } from "@gap/content";
import { duplicateLibraryWriteup, editChangesWriteup, editLibraryWriteup, newLibraryWriteup, type WriteupLibraryEdit } from "@gap/engine";
import { TRD_PART_KIND_LABELS, TRD_PART_KINDS, type TrdLibraryPart, type TrdLibraryWriteup, type TrdPartKind } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Empty, Modal } from "../components";
import { dateTime } from "../lib";
import { href } from "../router";
import { SERVER_MODE } from "../server/mode";
import { actorOf, useContent, useStore } from "../store";
import { useTrdWriteupLibrary, useTrdWriteups } from "../trd-writeups-store";

/**
 * The write-up library of the TRD: the process descriptions a TRD is written from. The shipped write-ups are never changed; an edit is
 * saved as the user's copy with the next version number and the earlier content kept in the history. A TRD keeps its own copy, so an
 * edit here never reaches a TRD by itself ("Update from library" in the TRD asks first).
 */
export function TrdLibraryPage() {
  const library = useTrdWriteupLibrary();
  const items = useTrdWriteups((s) => s.items);
  const ready = useTrdWriteups((s) => s.ready);
  const storeError = useTrdWriteups((s) => s.error);
  const save = useTrdWriteups((s) => s.save);
  const remove = useTrdWriteups((s) => s.remove);
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<TrdLibraryWriteup | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const editing = library.find((w) => w.id === editId);
  const shippedIds = useMemo(() => new Set(trdWriteups.map((w) => w.id)), []);
  const mine = new Set(items.map((w) => w.id));
  const content = useContent();
  const unitLabel = (key: string) => content.catalog.unitOperations.find((u) => u.key === key)?.label ?? key;

  const statusOf = (w: TrdLibraryWriteup) => (shippedIds.has(w.id) ? (mine.has(w.id) ? "Shipped, edited by you" : "Shipped") : "Yours");
  const who = () => {
    const p = useStore.getState().project;
    return p ? actorOf(p).name : "Unnamed user";
  };
  const back = () => setTimeout(() => opener.current?.focus(), 0);

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>Process description library</h1>
      </PageBanner>
      <p className="no-print">
        <a href={href("/trd")}>TRDs</a>
      </p>
      <section className="card stack" aria-labelledby="twl-about">
        <h2 id="twl-about">What this is</h2>
        <p>The process descriptions a TRD is written from: one per unit operation, and the TRD-level sections such as the introduction or the fill weights.</p>
        <ul className="plain-list">
          <li>{SERVER_MODE ? "Your edits are kept on the server for your account." : "Your edits are kept in this browser, not in the project file."}</li>
          <li>The shipped write-ups are not changed. Editing one saves your copy with the next version number, and the earlier content stays in its history.</li>
          <li>A TRD keeps its own copy and the version it was made from. When the library has a newer version, the TRD shows "Update from library" and you choose.</li>
          <li>
            A blank is written <code>{"{{key|Label}}"}</code>. The key names the project or TRD value that fills it; with no value the blank stays visible in the TRD and in the export. Nothing is filled in for you.
          </li>
        </ul>
      </section>

      {storeError && (
        <p className="notice" role="alert" data-testid="twl-error">
          {storeError}
        </p>
      )}
      <div role="status" aria-live="polite">
        {message && <p data-testid="twl-message">{message}</p>}
      </div>

      <section className="card stack" aria-labelledby="twl-list">
        <div className="row between wrap">
          <h2 id="twl-list">Write-ups ({library.length})</h2>
          <button
            type="button"
            className="btn primary"
            data-testid="twl-new"
            onClick={(e) => {
              opener.current = e.currentTarget;
              setEditId(null);
              setCreating(true);
              setMessage("");
            }}
          >
            New write-up
          </button>
        </div>
        {!ready ? (
          <Empty>Loading the write-ups.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Write-ups table" tabIndex={0}>
            <table className="data" data-testid="twl-table">
              <thead>
                <tr>
                  <th scope="col">Write-up</th>
                  <th scope="col">For</th>
                  <th scope="col">Version</th>
                  <th scope="col">Source</th>
                  <th scope="col">Parts</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {library.map((w) => (
                  <tr key={w.id} data-testid={`twl-row-${w.id}`}>
                    <th scope="row">{w.title}</th>
                    <td className="small">{w.kind === "unitOp" ? `Unit operation: ${unitLabel(w.key)}` : "TRD section"}</td>
                    <td className="num">{w.version}</td>
                    <td className="small">{statusOf(w)}</td>
                    <td className="num">{w.parts.length}</td>
                    <td>
                      <span className="row wrap">
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`Edit write-up ${w.title}`}
                          data-testid={`twl-edit-${w.id}`}
                          onClick={(e) => {
                            opener.current = e.currentTarget;
                            setCreating(false);
                            setEditId(w.id);
                            setMessage("");
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`Duplicate write-up ${w.title}`}
                          data-testid={`twl-dup-${w.id}`}
                          onClick={async (e) => {
                            opener.current = e.currentTarget;
                            const taken = new Set(library.map((x) => x.id));
                            let n = 2;
                            let id = `${w.id}_copy`;
                            while (taken.has(id)) id = `${w.id}_copy${n++}`;
                            const copy = duplicateLibraryWriteup(w, id, `${w.title} (copy)`, new Date().toISOString(), who());
                            await save(copy);
                            setMessage(`Copy "${copy.title}" added as version 1. It is offered in the picker and is not added to new TRDs by itself.`);
                          }}
                        >
                          Duplicate
                        </button>
                        {mine.has(w.id) && (
                          <button
                            type="button"
                            className="btn small"
                            aria-label={shippedIds.has(w.id) ? `Back to shipped: ${w.title}` : `Remove write-up ${w.title}`}
                            data-testid={`twl-remove-${w.id}`}
                            onClick={(e) => {
                              opener.current = e.currentTarget;
                              setConfirm(w);
                            }}
                          >
                            {shippedIds.has(w.id) ? "Back to shipped" : "Remove"}
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
        <WriteupForm
          key="new"
          cur={undefined}
          taken={new Set(library.map((w) => w.id))}
          onCancel={() => {
            setCreating(false);
            back();
          }}
          onSave={async (edit, meta) => {
            await save(newLibraryWriteup(meta.id, meta.kind, meta.key, { title: edit.title ?? "", ...edit }, new Date().toISOString(), who()));
            setCreating(false);
            setMessage(`Write-up "${edit.title}" added as version 1.`);
            back();
          }}
        />
      )}
      {editing && (
        <WriteupForm
          key={editing.id}
          cur={editing}
          taken={new Set()}
          onCancel={() => {
            setEditId(null);
            back();
          }}
          onSave={async (edit) => {
            if (!editChangesWriteup(editing, edit)) {
              setMessage("Nothing changed, so no new version was made.");
              return;
            }
            const next = editLibraryWriteup(editing, edit, new Date().toISOString(), who());
            await save(next);
            setEditId(null);
            setMessage(`Write-up "${next.title}" saved as version ${next.version}. TRDs made from an earlier version show "Update from library".`);
            back();
          }}
        />
      )}

      {confirm && (
        <Modal
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={shippedIds.has(confirm.id) ? "Bring back the shipped version?" : "Remove this write-up?"}
          description={shippedIds.has(confirm.id) ? `${confirm.title}: your edits (version ${confirm.version}) are removed from the list. TRDs keep their own copies.` : `${confirm.title}: removed from the library. TRDs keep their own copies.`}
          restoreFocus={() => opener.current}
        >
          <div className="row end">
            <button type="button" className="btn" autoFocus onClick={() => setConfirm(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="twl-confirm-remove"
              onClick={async () => {
                const w = confirm;
                setConfirm(null);
                await remove(w.id);
                setMessage(shippedIds.has(w.id) ? `The shipped version of "${w.title}" is back.` : `Write-up "${w.title}" removed.`);
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

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
/** Library part ids are lower-case words; the "x_" start is kept for parts an author adds inside a TRD. */
const newPartId = () => `p_${Math.random().toString(36).slice(2, 8)}`;

function WriteupForm({
  cur,
  taken,
  onSave,
  onCancel,
}: {
  cur: TrdLibraryWriteup | undefined;
  taken: ReadonlySet<string>;
  onSave: (edit: WriteupLibraryEdit, meta: { id: string; kind: "unitOp" | "section"; key: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const content = useContent();
  const [title, setTitle] = useState(cur?.title ?? "");
  const [kind, setKind] = useState<"unitOp" | "section">(cur?.kind ?? "unitOp");
  const [unitOp, setUnitOp] = useState(cur?.kind === "unitOp" ? cur.key : (content.catalog.unitOperations[0]?.key ?? ""));
  const [appliesWhen, setAppliesWhen] = useState(cur?.appliesWhen ?? "");
  const [parts, setParts] = useState<TrdLibraryPart[]>(cur?.parts ?? []);
  const [naOn, setNaOn] = useState(Boolean(cur?.notApplicable));
  const [naCondition, setNaCondition] = useState(cur?.notApplicable?.condition ?? "");
  const [naText, setNaText] = useState(cur?.notApplicable?.text ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const setPart = (i: number, patch: Partial<TrdLibraryPart>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i: number, by: -1 | 1) =>
    setParts((ps) => {
      const j = i + by;
      if (j < 0 || j >= ps.length) return ps;
      const n = [...ps];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });

  async function submit() {
    if (!title.trim()) return setError("Give the write-up a title.");
    if (!cur && kind === "unitOp" && !unitOp) return setError("Choose the unit operation.");
    const clean = parts.map((p) => {
      const { optional, title: t, columns, rows, ...rest } = p;
      const cond = optional?.condition.trim();
      return {
        ...rest,
        ...(t?.trim() ? { title: t.trim() } : {}),
        ...(columns?.length ? { columns } : {}),
        ...(rows?.length ? { rows } : {}),
        ...(optional ? { optional: { condition: cond || "include if it applies" } } : {}),
      } satisfies TrdLibraryPart;
    });
    const bad = clean.find((p) => (p.kind === "subsection" || p.kind === "heading" ? !p.title : p.kind === "table" ? !p.columns?.length : !p.text.trim()));
    if (bad) return setError(`A ${TRD_PART_KIND_LABELS[bad.kind].toLowerCase()} needs ${bad.kind === "subsection" || bad.kind === "heading" ? "a title" : bad.kind === "table" ? "column heads" : "text"}.`);
    if (naOn && !naCondition.trim()) return setError("Say when the write-up is not applicable.");
    const edit: WriteupLibraryEdit = {
      title,
      appliesWhen,
      parts: clean,
      ...(naOn ? { notApplicable: { condition: naCondition.trim(), text: naText } } : {}),
    };
    let id = cur?.id ?? "";
    if (!cur) {
      const base = kind === "unitOp" ? `wu_${unitOp}_${slug(title) || "custom"}` : `sec_${slug(title) || "custom"}`;
      id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(edit, { id, kind, key: kind === "unitOp" ? unitOp : slug(title) || "custom" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="twl-form-h" data-testid="twl-form">
      <h2 id="twl-form-h" tabIndex={-1} ref={heading}>
        {cur ? `Edit write-up: ${cur.title} (now version ${cur.version})` : "New write-up"}
      </h2>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="twl-title" />
      </label>
      {!cur && (
        <div className="row wrap">
          <label className="field">
            <span>Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as "unitOp" | "section")} data-testid="twl-kind">
              <option value="unitOp">Process description of a unit operation</option>
              <option value="section">TRD section</option>
            </select>
          </label>
          {kind === "unitOp" && (
            <label className="field">
              <span>Unit operation</span>
              <select value={unitOp} onChange={(e) => setUnitOp(e.target.value)} data-testid="twl-unitop">
                {content.catalog.unitOperations.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <label className="field">
        <span>When it fits (optional, a hint for the author, not a rule)</span>
        <input value={appliesWhen} onChange={(e) => setAppliesWhen(e.target.value)} />
      </label>

      <fieldset className="fs stack" data-testid="twl-parts">
        <legend>Parts ({parts.length})</legend>
        <p className="muted small">
          Write a blank as <code>{"{{key|Label}}"}</code> and bold as <code>**bold**</code>. An optional part starts switched off in a TRD.
        </p>
        {parts.length === 0 && <p className="muted small">No parts yet.</p>}
        <ol className="plain-list stack">
          {parts.map((p, i) => (
            <li key={p.id} className="card stack" data-testid={`twl-part-${i}`}>
              <div className="row wrap end-align">
                <label className="field">
                  <span>Kind of part {i + 1}</span>
                  <select value={p.kind} onChange={(e) => setPart(i, { kind: e.target.value as TrdPartKind })} data-testid={`twl-part-kind-${i}`}>
                    {TRD_PART_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {TRD_PART_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
                {(p.kind === "subsection" || p.kind === "heading") && (
                  <label className="field grow">
                    <span>Title of part {i + 1}</span>
                    <input value={p.title ?? ""} onChange={(e) => setPart(i, { title: e.target.value })} />
                  </label>
                )}
                {p.kind === "table" && (
                  <label className="field grow">
                    <span>Column heads of part {i + 1} (comma between)</span>
                    <input value={(p.columns ?? []).join(", ")} onChange={(e) => setPart(i, { columns: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
                  </label>
                )}
              </div>
              {p.kind !== "subsection" && p.kind !== "heading" && p.kind !== "table" && (
                <label className="field">
                  <span>Text of part {i + 1}</span>
                  <textarea rows={3} value={p.text} onChange={(e) => setPart(i, { text: e.target.value })} data-testid={`twl-part-text-${i}`} />
                </label>
              )}
              <div className="row wrap end-align">
                <label className="check">
                  <input type="checkbox" checked={Boolean(p.optional)} onChange={(e) => setPart(i, e.target.checked ? { optional: { condition: p.optional?.condition ?? "" } } : { optional: undefined })} data-testid={`twl-part-optional-${i}`} />
                  <span>Optional part {i + 1}</span>
                </label>
                {p.optional && (
                  <label className="field grow">
                    <span>When to include part {i + 1}</span>
                    <input value={p.optional.condition} onChange={(e) => setPart(i, { optional: { condition: e.target.value } })} />
                  </label>
                )}
                <button type="button" className="btn small" aria-label={`Move part ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  Up
                </button>
                <button type="button" className="btn small" aria-label={`Move part ${i + 1} down`} disabled={i === parts.length - 1} onClick={() => move(i, 1)}>
                  Down
                </button>
                <button type="button" className="btn small" aria-label={`Remove part ${i + 1}`} onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <button type="button" className="btn small" data-testid="twl-part-add" onClick={() => setParts((ps) => [...ps, { id: newPartId(), kind: "paragraph", text: "" }])}>
            Add a part
          </button>
        </div>
      </fieldset>

      <fieldset className="fs stack">
        <legend>Not applicable (optional)</legend>
        <label className="check">
          <input type="checkbox" checked={naOn} onChange={(e) => setNaOn(e.target.checked)} />
          <span>This write-up can be marked not applicable in a TRD</span>
        </label>
        {naOn && (
          <>
            <label className="field">
              <span>When it is not applicable</span>
              <input value={naCondition} onChange={(e) => setNaCondition(e.target.value)} />
            </label>
            <label className="field">
              <span>Text shown instead</span>
              <textarea rows={2} value={naText} onChange={(e) => setNaText(e.target.value)} />
            </label>
          </>
        )}
      </fieldset>

      {cur && (cur.history?.length ?? 0) > 0 && (
        <div className="stack">
          <button type="button" className="btn small" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)} data-testid="twl-history-toggle">
            {showHistory ? "Hide" : "Show"} earlier versions ({cur.history!.length})
          </button>
          {showHistory && (
            <ul className="plain-list" data-testid="twl-history">
              {[...cur.history!].reverse().map((h) => (
                <li key={h.version}>
                  <strong>Version {h.version}</strong>: {h.title}, {h.parts.length} parts{h.at ? `, saved ${dateTime(h.at)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert" data-testid="twl-form-error">
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} data-testid="twl-save" onClick={() => void submit()}>
          {cur ? "Save as a new version" : "Save write-up"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
