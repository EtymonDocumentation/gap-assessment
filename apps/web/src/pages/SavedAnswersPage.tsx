import type { SavedAnswerSet } from "@gap/process-model";
import { savedDay } from "@gap/engine";
import { useEffect, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Empty, Modal } from "../components";
import { HelpTip } from "../HelpTip";
import { download, slug } from "../lib";
import { useSavedAnswers } from "../saved-answers-store";
import { SERVER_MODE } from "../server/mode";
import { useStore } from "../store";
import { ApplyAnswersDialog, SaveAnswersDialog, setSidesText } from "./SavedAnswersDialogs";

/**
 * Saved answers: the author's named sets of interview answers. Save the open project's answers, apply a set to the open project
 * (always through a review), rename, export, import and delete. The sets belong to the author (this browser, or the account on the
 * server), not to a project.
 */
export function SavedAnswersPage() {
  const project = useStore((s) => s.project);
  const items = useSavedAnswers((s) => s.items);
  const ready = useSavedAnswers((s) => s.ready);
  const storeError = useSavedAnswers((s) => s.error);
  const load = useSavedAnswers((s) => s.load);
  const remove = useSavedAnswers((s) => s.remove);
  const rename = useSavedAnswers((s) => s.rename);
  const importText = useSavedAnswers((s) => s.importText);
  useEffect(() => void load(), [load]);

  const [saving, setSaving] = useState(false);
  const [applyId, setApplyId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SavedAnswerSet | null>(null);
  const [newName, setNewName] = useState("");
  const [confirm, setConfirm] = useState<SavedAnswerSet | null>(null);
  const [message, setMessage] = useState("");
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restore = () => opener.current;

  const exportSet = (s: SavedAnswerSet) => {
    download(`saved-answers-${slug(s.name)}-${savedDay(s.savedAt)}.json`, JSON.stringify(s, null, 2), "application/json");
    setMessage(`Exported "${s.name}" as a file.`);
  };

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>
          Saved answers <HelpTip label="saved answers" text="Keep the answers of one project as a named set and offer them to another project. You always see every answer first and tick the ones you want. Nothing is applied on its own." />
        </h1>
      </PageBanner>
      <p>
        Your own sets of interview answers. {SERVER_MODE ? "They are kept on the server for your account." : "They are kept in this browser, not in the project file; use Export set to move one to another browser."}
      </p>

      {storeError && (
        <p className="notice" role="alert" data-testid="sa-error">
          {storeError}
        </p>
      )}
      <div role="status" aria-live="polite">
        {message && <p data-testid="sa-message">{message}</p>}
      </div>

      <section className="card stack" aria-labelledby="sa-list-h">
        <div className="row between wrap">
          <h2 id="sa-list-h">Your sets ({items.length})</h2>
          <div className="row wrap">
            {project ? (
              <button
                type="button"
                className="btn primary"
                data-testid="sa-save-open"
                onClick={(e) => {
                  opener.current = e.currentTarget;
                  setMessage("");
                  setSaving(true);
                }}
              >
                Save answers from the open project
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              data-testid="sa-import"
              onClick={() => {
                setImportError("");
                fileRef.current?.click();
              }}
            >
              Import set
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              aria-label="Saved answer set file to import"
              tabIndex={-1}
              data-testid="sa-import-file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setMessage("");
                const r = await importText(await f.text());
                if ("error" in r) setImportError(r.error);
                else {
                  setImportError("");
                  setMessage(`Imported "${r.set.name}": ${r.set.answers.length} ${r.set.answers.length === 1 ? "answer" : "answers"}.`);
                }
              }}
            />
          </div>
        </div>
        {!project && <p className="small muted">Open a project to save its answers or to apply a set to it.</p>}
        {importError && (
          <p className="notice" role="alert" data-testid="sa-import-error">
            <strong>Import failed.</strong> {importError}
          </p>
        )}
        {!ready ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <Empty>No saved sets yet. Answer some questions in a project and use "Save answers from the open project", or import a set file.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Saved answer sets" tabIndex={0}>
            <table data-testid="sa-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Units</th>
                  <th scope="col">Questions</th>
                  <th scope="col">Saved</th>
                  <th scope="col">From project</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} data-testid={`sa-row-set-${s.id}`}>
                    <th scope="row">{s.name}</th>
                    <td>{setSidesText(s.sides)}</td>
                    <td className="num">{s.answers.length}</td>
                    <td>{savedDay(s.savedAt)}</td>
                    <td>{s.sourceProject || "Not recorded"}</td>
                    <td>
                      <span className="row wrap">
                        {project && (
                          <button
                            type="button"
                            className="btn small"
                            aria-label={`Apply ${s.name} to the open project`}
                            data-testid={`sa-apply-${s.id}`}
                            onClick={(e) => {
                              opener.current = e.currentTarget;
                              setMessage("");
                              setApplyId(s.id);
                            }}
                          >
                            Apply
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`Rename ${s.name}`}
                          data-testid={`sa-rename-${s.id}`}
                          onClick={(e) => {
                            opener.current = e.currentTarget;
                            setNewName(s.name);
                            setRenaming(s);
                          }}
                        >
                          Rename
                        </button>
                        <button type="button" className="btn small" aria-label={`Export set ${s.name}`} data-testid={`sa-export-${s.id}`} onClick={() => exportSet(s)}>
                          Export set
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`Delete ${s.name}`}
                          data-testid={`sa-delete-${s.id}`}
                          onClick={(e) => {
                            opener.current = e.currentTarget;
                            setConfirm(s);
                          }}
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {saving && project && <SaveAnswersDialog onClose={() => setSaving(false)} onSaved={(s) => setMessage(`Saved "${s.name}": ${s.answers.length} ${s.answers.length === 1 ? "answer" : "answers"} (${setSidesText(s.sides)}).`)} />}
      {applyId && project && <ApplyAnswersDialog initialId={applyId} onClose={() => setApplyId(null)} onApplied={(n) => setMessage(`Applied ${n} ${n === 1 ? "answer" : "answers"} to the open project. Each shows where it came from on its question.`)} />}

      {renaming && (
        <Modal open onOpenChange={(o) => !o && setRenaming(null)} title="Rename this set" restoreFocus={restore}>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              const s = renaming;
              setRenaming(null);
              await rename(s.id, newName);
              setMessage(`Renamed to "${newName.trim()}".`);
            }}
          >
            <label className="field">
              <span>New name (required)</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} autoFocus data-testid="sa-rename-input" />
            </label>
            <div className="row end">
              <button type="button" className="btn" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!newName.trim()} data-testid="sa-rename-save">
                Rename
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirm && (
        <Modal
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Delete this set?"
          description={`"${confirm.name}" (${confirm.answers.length} answers) is removed from your list. Projects it was applied to keep their answers and the note of where they came from.`}
          restoreFocus={restore}
        >
          <div className="row end">
            <button type="button" className="btn" autoFocus onClick={() => setConfirm(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="sa-confirm-delete"
              onClick={async () => {
                const s = confirm;
                setConfirm(null);
                try {
                  await remove(s.id);
                  setMessage(`Deleted "${s.name}".`);
                } catch {
                  /* the reason is shown at the top of the page */
                }
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
