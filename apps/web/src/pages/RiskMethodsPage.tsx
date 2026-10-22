import { describeMethod, METHOD_LABEL } from "@gap/risk";
import { useEffect, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Empty, Modal } from "../components";
import { dateTime } from "../lib";
import { href } from "../router";
import { useRiskMethods, type StoredMethod } from "../risk-methods-store";
import { SERVER_MODE } from "../server/mode";

/**
 * The risk method library: the methods your company has defined (scales, bands, matrix, factors), kept outside any project like the
 * sampling tables. A method is defined and saved from an assessment (Method step); this page lists them, changes their name, version,
 * document reference and owner, shows their history and deletes them. The tool ships no method of its own here: the starters on the
 * Method step are shapes to edit, not library entries.
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
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<StoredMethod | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const editing = items.find((m) => m.id === editId);

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>Risk methods</h1>
      </PageBanner>
      <section className="card stack" aria-labelledby="rml-about">
        <h2 id="rml-about">What this is</h2>
        <p>
          A risk method is the way your quality system scores risk: its scales, the bands or labels, the matrix. Define one on the Method step of a <a href={href("/risk")}>risk assessment</a> and save it here to reuse it.
        </p>
        <ul className="plain-list">
          <li>{SERVER_MODE ? "Methods are kept on the server for your account." : "Methods are kept in this browser, not in the project file."}</li>
          <li>An assessment keeps its own copy of the method and the name and version it came from, so changing a method here never changes an assessment that was already made.</li>
          <li>Saving a change keeps the earlier wording in the method's history.</li>
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
        <h2 id="rml-list">Your methods ({items.length})</h2>
        {!ready ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <Empty>No saved method yet. Define a method in an assessment, then save it to the library.</Empty>
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
                        <button type="button" className="btn small" aria-label={`Edit ${m.name}`} onClick={() => setEditId(m.id)}>
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

      {editing && (
        <MethodEditor
          key={editing.id}
          m={editing}
          onClose={() => setEditId(null)}
          onSave={async (next) => {
            try {
              const saved = await save(next);
              setMessage(`Saved ${saved.name}, version ${saved.version}.`);
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

function MethodEditor({ m, onClose, onSave }: { m: StoredMethod; onClose: () => void; onSave: (m: StoredMethod) => Promise<void> }) {
  const [name, setName] = useState(m.name);
  const [version, setVersion] = useState(m.version);
  const [docRef, setDocRef] = useState(m.docRef ?? "");
  const [owner, setOwner] = useState(m.owner ?? "");
  const d = describeMethod(m.config);
  const dirty = name !== m.name || version !== m.version || docRef !== (m.docRef ?? "") || owner !== (m.owner ?? "");
  return (
    <section className="card stack" aria-labelledby="rml-edit" data-testid="method-editor">
      <h2 id="rml-edit">Edit {m.name}</h2>
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
          <input value={docRef} onChange={(e) => setDocRef(e.target.value)} />
        </label>
        <label className="field grow">
          <span>
            Owner <span className="muted">(optional)</span>
          </span>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} />
        </label>
      </div>
      <p className="small">
        <strong>{d.title}.</strong> {d.formula} {d.bandsText}
      </p>
      {d.problems.length > 0 && (
        <div className="notice">
          <p>Open items in this method:</p>
          <ul className="plain-list small">
            {d.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted small">To change scales, bands or labels, apply the method in an assessment, edit it there and save it here as a new version.</p>
      <div className="row wrap">
        <button
          type="button"
          className="btn primary"
          disabled={!dirty || !name.trim() || !version.trim()}
          data-testid="method-save"
          onClick={() => {
            // The library's save() drops an empty document reference or owner, so clearing a field clears it.
            const { docRef: _d, owner: _o, ...rest } = m;
            void _d;
            void _o;
            void onSave({ ...rest, name: name.trim(), version: version.trim(), ...(docRef.trim() ? { docRef: docRef.trim() } : {}), ...(owner.trim() ? { owner: owner.trim() } : {}) });
          }}
        >
          Save
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close the editor
        </button>
      </div>
      {m.history.length > 0 && (
        <details data-testid="method-history">
          <summary>Edit history ({m.history.length})</summary>
          <ul className="plain-list small">
            {[...m.history].reverse().map((h, i) => (
              <li key={`${h.at}-${i}`}>
                {dateTime(h.at)}: {h.action === "created" ? "created" : "edited"}
                {h.before ? `. Before the edit: ${h.before.name}, version ${h.before.version}.` : "."}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
