import type { RiskConfig } from "@gap/process-model";
import { describeMethod, METHOD_LABEL } from "@gap/risk";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Empty, Modal } from "../components";
import { dateTime } from "../lib";
import { href } from "../router";
import { configToDraft, draftToConfig, emptyDraft, type Draft } from "../risk-draft";
import { contentKey } from "../risk-library";
import { newMethodId, useRiskMethods, type StoredMethod } from "../risk-methods-store";
import { SERVER_MODE } from "../server/mode";
import { DraftFields, DraftProblems, StarterPicker } from "./RiskMethod";

/**
 * The risk method library: the methods your company has defined (scales, bands, matrix, factors), kept outside any project like the
 * sampling tables. A method is created here (from a starter or blank) or saved from an assessment, and is edited here in full with the
 * same editors the Method step uses. Every save keeps the earlier content in the method's history. The tool ships no method of its
 * own: the starters are shapes to edit, not library entries, and nothing is pre-filled beyond the starter the person picks.
 */
export function RiskMethodsPage() {
  const items = useRiskMethods((s) => s.items);
  const ready = useRiskMethods((s) => s.ready);
  const storeError = useRiskMethods((s) => s.error);
  const load = useRiskMethods((s) => s.load);
  const save = useRiskMethods((s) => s.save);
  const remove = useRiskMethods((s) => s.remove);
  useEffect(() => void load(), [load]);
  const [editId, setEditId] = useState<string | null>(null);
  // A method that is not saved yet: its id is fixed when the person starts it, so saving twice cannot make two entries.
  const [creating, setCreating] = useState<{ id: string; draft: Draft; from: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<StoredMethod | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const editing = items.find((m) => m.id === editId);

  const startNew = (draft: Draft, from: string) => {
    setEditId(null);
    setStarting(false);
    setMessage("");
    setCreating({ id: newMethodId(), draft, from });
  };

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>Risk methods</h1>
      </PageBanner>
      <section className="card stack" aria-labelledby="rml-about">
        <h2 id="rml-about">What this is</h2>
        <p>
          A risk method is the way your quality system scores risk: its scales, the bands or labels, the matrix. Create and edit methods here, or define one on the Method step of a <a href={href("/risk")}>risk assessment</a> and save it here to reuse it.
        </p>
        <ul className="plain-list">
          <li>{SERVER_MODE ? "Methods are kept on the server for your account." : "Methods are kept in this browser, not in the project file."}</li>
          <li>An assessment keeps its own copy of the method and the name and version it came from, so changing a method here never changes an assessment that was already made. An assessment whose method has a newer library version shows a note and an "Update from library" button.</li>
          <li>Saving a change keeps the earlier content in the method's history. Give the method a new version when its scales, bands or labels change, so an assessment can tell its copy from the newer one.</li>
        </ul>
      </section>

      {storeError && (
        <p className="notice" role="alert" data-testid="methods-error">
          {storeError}
        </p>
      )}
      <div role="status" aria-live="polite">
        {message && <p data-testid="methods-message">{message}</p>}
      </div>

      <section className="card stack" aria-labelledby="rml-list">
        <div className="row between wrap">
          <h2 id="rml-list">Your methods ({items.length})</h2>
          <button
            type="button"
            className="btn primary"
            data-testid="method-new"
            aria-expanded={starting}
            aria-controls="rml-start"
            onClick={() => {
              setStarting((v) => !v);
            }}
          >
            New method
          </button>
        </div>
        {starting && (
          <div id="rml-start" className="stack" data-testid="method-start">
            <p className="muted small">
              The tool has no default method. A starter is a shape you may take and then change; its scales, bands and labels are examples, not rules. Nothing is saved until you give the method a name and a version and save it.
            </p>
            <StarterPicker
              idPrefix="lib"
              onLoadout={(l) => startNew(configToDraft({ ...structuredClone(l.config), loadoutId: l.id }), l.title)}
              onBlank={(m) => startNew(emptyDraft(m), `Blank ${METHOD_LABEL[m]}`)}
            />
          </div>
        )}
        {!ready ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <Empty>No saved method yet. Use "New method", or define a method in an assessment and save it to the library.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Risk methods list" tabIndex={0}>
            <table className="data" data-testid="methods-list">
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Version</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Document</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Last changed</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id}>
                    <th scope="row">{m.name}</th>
                    <td>{m.version}</td>
                    <td>{METHOD_LABEL[m.config.method]}</td>
                    <td>{m.docRef ?? <span className="muted">Not given</span>}</td>
                    <td>{m.owner ?? <span className="muted">Not given</span>}</td>
                    <td className="small">{dateTime(m.updatedAt)}</td>
                    <td>
                      <div className="row wrap">
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`Edit ${m.name}`}
                          onClick={() => {
                            setCreating(null);
                            setMessage("");
                            setEditId(m.id);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn small danger"
                          aria-label={`Delete ${m.name}`}
                          onClick={(e) => {
                            opener.current = e.currentTarget;
                            setConfirm(m);
                          }}
                        >
                          Delete
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

      {creating && (
        <MethodEditor
          key={creating.id}
          m={null}
          id={creating.id}
          initial={creating.draft}
          from={creating.from}
          onClose={() => setCreating(null)}
          onSave={async (next) => {
            try {
              const saved = await save(next);
              setMessage(`Saved ${saved.name}, version ${saved.version}.`);
              // From here on it is an ordinary entry of the library.
              setCreating(null);
              setEditId(saved.id);
            } catch {
              setMessage("");
            }
          }}
        />
      )}

      {editing && (
        <MethodEditor
          key={editing.id}
          m={editing}
          id={editing.id}
          initial={configToDraft(editing.config)}
          onClose={() => setEditId(null)}
          onSave={async (next) => {
            try {
              const saved = await save(next);
              setMessage(`Saved ${saved.name}, version ${saved.version}. The earlier content is kept in the history.`);
            } catch {
              setMessage("");
            }
          }}
        />
      )}

      {confirm && (
        <Modal open onOpenChange={(o) => !o && setConfirm(null)} title="Delete this method?" description={`${confirm.name}, version ${confirm.version}. Assessments that used it keep their own copy.`} restoreFocus={() => opener.current}>
          <div className="row end">
            <button type="button" className="btn" autoFocus onClick={() => setConfirm(null)}>
              Keep the method
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="method-delete-confirm"
              onClick={() => {
                const id = confirm.id;
                setConfirm(null);
                if (editId === id) setEditId(null);
                void remove(id).then(() => setMessage("Method deleted."), () => undefined);
              }}
            >
              Delete method
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** A library entry as the editor builds it (the library adds its own dates and history when it stores it). */
type Next = { id: string; name: string; version: string; docRef?: string; owner?: string; config: RiskConfig };

/**
 * Edits one method: its name, version, document and owner, and its whole configuration with the editors of the Method step. `m` is
 * null while the method is new. The kind of method is fixed (a different kind of method is a different method).
 */
function MethodEditor({ m, id, initial, from, onClose, onSave }: { m: StoredMethod | null; id: string; initial: Draft; from?: string; onClose: () => void; onSave: (next: Next) => Promise<void> }) {
  const [name, setName] = useState(m?.name ?? "");
  const [version, setVersion] = useState(m?.version ?? "");
  const [docRef, setDocRef] = useState(m?.docRef ?? "");
  const [owner, setOwner] = useState(m?.owner ?? "");
  const [draft, setDraft] = useState<Draft>(initial);
  const result = useMemo(() => draftToConfig(draft), [draft]);
  /** A library entry never carries a link to another library entry: that link belongs to the assessment that uses it. */
  const config = result.ok ? ((): RiskConfig => { const { libraryRef: _l, ...rest } = result.config; void _l; return rest as RiskConfig; })() : undefined;
  const d = config ? describeMethod(config) : undefined;
  const edit = (fn: (d: Draft) => void) => {
    const n = structuredClone(draft);
    fn(n);
    setDraft(n);
  };
  const contentChanged = !m || !config || contentKey(config) !== contentKey(m.config);
  const dirty = !m || contentChanged || name !== m.name || version !== m.version || docRef !== (m.docRef ?? "") || owner !== (m.owner ?? "");
  const sameVersion = !!m && version.trim() === m.version && !!config && contentKey(config) !== contentKey(m.config);
  const title = m ? `Edit ${m.name}` : `New method${from ? ` from ${from}` : ""}`;
  return (
    <section className="card stack" aria-labelledby="rml-edit" data-testid="method-editor">
      <h2 id="rml-edit">{title}</h2>
      <div className="row wrap">
        <label className="field grow">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} data-testid="method-name" />
        </label>
        <label className="field">
          <span>Version</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} data-testid="method-version" />
        </label>
      </div>
      <div className="row wrap">
        <label className="field grow">
          <span>
            Document that defines it <span className="muted">(optional)</span>
          </span>
          <input value={docRef} onChange={(e) => setDocRef(e.target.value)} data-testid="method-docref" />
        </label>
        <label className="field grow">
          <span>
            Owner <span className="muted">(optional)</span>
          </span>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} data-testid="method-owner" />
        </label>
      </div>

      <h3>The method: {METHOD_LABEL[draft.method]}</h3>
      <DraftFields draft={draft} edit={edit} />
      <DraftProblems result={result} testid="method-problems" showOpen />

      {d && (
        <p className="small" data-testid="method-summary">
          <strong>{d.title}.</strong> {d.formula} {d.bandsText}
        </p>
      )}
      {sameVersion && (
        <p className="notice" data-testid="method-same-version" role="status">
          The scales, bands or labels changed but the version is still {m!.version}. You can save it so, but assessments will not see that a newer version exists; give it a new version to let them tell.
        </p>
      )}
      <div className="row wrap">
        <button
          type="button"
          className="btn primary"
          disabled={!dirty || !result.ok || !name.trim() || !version.trim()}
          data-testid="method-save"
          onClick={() => config && void onSave({ id, name: name.trim(), version: version.trim(), ...(docRef.trim() ? { docRef: docRef.trim() } : {}), ...(owner.trim() ? { owner: owner.trim() } : {}), config })}
        >
          {m ? "Save as the next version" : "Save to the library"}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close the editor
        </button>
      </div>
      {m && m.history.length > 0 && (
        <details data-testid="method-history">
          <summary>Edit history ({m.history.length})</summary>
          <ul className="plain-list small">
            {m.history
              .map((h, i) => {
                // What the method became with this edit: the next entry's "before", or the method as it is now.
                const after = m.history[i + 1]?.before ?? m;
                const changed = h.before ? contentKey(h.before.config) !== contentKey(after.config) : false;
                return (
                  <li key={`${h.at}-${i}`}>
                    {dateTime(h.at)}: {h.action === "created" ? "created" : "edited"}
                    {h.before ? `. Before the edit: ${h.before.name}, version ${h.before.version}${changed ? "; scales, bands or labels were changed by this edit" : ""}.` : "."}
                  </li>
                );
              })
              .reverse()}
          </ul>
        </details>
      )}
    </section>
  );
}
