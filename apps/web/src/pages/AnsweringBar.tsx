import { answeringFrom, answeringFromText, clearAnsweringFrom, setAnsweringFrom, sourceShort } from "@gap/engine";
import { addSource, type AnsweringFrom } from "@gap/process-model";
import { useId, useRef, useState } from "react";
import { useStore } from "../store";

/** What the last automatic citation did, shown with an Undo until the next answer is saved. */
export interface CiteNotice {
  text: string;
  /** Opaque to the bar: handed back to onUndo. */
  token: unknown;
}

const NEW_DOC = "__new__";

/**
 * "Answering from": the sticky bar on the Interview page. While a document is chosen, every answer saved with a value is cited
 * to it (see autoCiteAnswer). The choice is saved in the project, so it survives a reload and a different browser tab.
 *
 * The bar never writes a value. At phone width it is one compact line; the form opens only when asked for.
 */
export function AnsweringBar({ notice, onUndo, onDismissNotice }: { notice: CiteNotice | null; onUndo: () => void; onDismissNotice: () => void }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const bar = answeringFrom(project);
  const docs = project.sources.filter((s) => s.type === "document_reference" && !s.supersededBy);

  const [open, setOpen] = useState(false);
  const [docId, setDocId] = useState(bar?.sourceId ?? "");
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newVersion, setNewVersion] = useState("");
  const [sides, setSides] = useState<AnsweringFrom["sides"]>(bar?.sides ?? "both");
  const [section, setSection] = useState(bar?.section ?? "");
  const [page, setPage] = useState(bar?.page ?? "");
  const [error, setError] = useState("");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const errId = useId();

  const openForm = () => {
    // Start from what is set now, so changing one thing does not mean re-typing the rest.
    setDocId(bar?.sourceId ?? "");
    setSides(bar?.sides ?? "both");
    setSection(bar?.section ?? "");
    setPage(bar?.page ?? "");
    setError("");
    setOpen(true);
  };

  const submit = () => {
    setError("");
    if (!docId) return setError("Choose a document, or add a new one.");
    if (docId === NEW_DOC && !newId.trim()) return setError("Enter the document ID.");
    const input = (sourceId: string): AnsweringFrom => ({ sourceId, sides, ...(section.trim() ? { section: section.trim() } : {}), ...(page.trim() ? { page: page.trim() } : {}) });
    const err = update((p, actor) => {
      let sourceId = docId;
      let cur = p;
      if (docId === NEW_DOC) {
        // The document type is not asked for here; "Document" is what the interview's own "Add a new document" uses too.
        const added = addSource(cur, { type: "document_reference", docRef: { identifier: newId.trim(), docType: "Document", ...(newTitle.trim() ? { title: newTitle.trim() } : {}), ...(newVersion.trim() ? { version: newVersion.trim() } : {}) } }, actor);
        cur = added.project;
        sourceId = added.source.id;
      }
      return setAnsweringFrom(cur, input(sourceId), actor);
    }, "Answering from a document");
    if (err) return setError(err);
    setNewId("");
    setNewTitle("");
    setNewVersion("");
    setOpen(false);
    toggleRef.current?.focus();
  };

  return (
    <section
      className="answering-bar"
      aria-label="Answering from"
      // Escape closes the form from anywhere in the bar, the toggle button included.
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          toggleRef.current?.focus();
        }
      }}
    >
      <div className="ab-line">
        <strong className="ab-label">Answering from:</strong>
        {bar ? (
          <span className="ab-doc" title={answeringFromText(bar)}>
            {answeringFromText(bar)}
          </span>
        ) : (
          <span className="ab-doc muted">no document chosen</span>
        )}
        <button ref={toggleRef} type="button" className="btn small" aria-expanded={open} aria-controls={formId} onClick={() => (open ? setOpen(false) : openForm())}>
          {bar ? "Change" : "Choose a document"}
        </button>
        {bar && (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              update((p, actor) => clearAnsweringFrom(p, actor), "No longer answering from a document");
              setOpen(false);
            }}
          >
            Clear<span className="visually-hidden"> answering from</span>
          </button>
        )}
      </div>

      {notice && (
        <p className="ab-notice" role="status">
          <span>{notice.text}</span>
          <button type="button" className="btn small" onClick={onUndo}>
            <span aria-hidden="true">✕ </span>Undo<span className="visually-hidden"> citation</span>
          </button>
          <button type="button" className="link-btn small" onClick={onDismissNotice}>
            Dismiss
          </button>
        </p>
      )}

      {open && (
        <form
          id={formId}
          className="ab-form stack"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="small muted">
            While a document is chosen, each answer you save with a value is cited to it. TBD without a best guess and “Same as SU” are not cited.
          </p>
          <div className="row wrap">
            <label className="field">
              <span>Document</span>
              <select aria-label="Document" value={docId} onChange={(e) => setDocId(e.target.value)} aria-describedby={error ? errId : undefined}>
                <option value="">Choose…</option>
                {docs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {sourceShort(s)}
                  </option>
                ))}
                <option value={NEW_DOC}>Add a new document…</option>
              </select>
            </label>
            <fieldset className="segmented">
              <legend className="small">Cite on</legend>
              {(
                [
                  ["source", "SU"],
                  ["target", "RU"],
                  ["both", "Both"],
                ] as const
              ).map(([v, t]) => (
                <label key={v}>
                  <input type="radio" name={`${formId}-sides`} value={v} checked={sides === v} onChange={() => setSides(v)} />
                  <span>{t}</span>
                </label>
              ))}
            </fieldset>
          </div>
          {docId === NEW_DOC && (
            <div className="row wrap">
              <label className="field">
                <span>Document ID</span>
                <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="e.g. DEMO-PPQ-001 (fictional)" />
              </label>
              <label className="field">
                <span>Title</span>
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
              </label>
              <label className="field compact">
                <span>Version</span>
                <input value={newVersion} onChange={(e) => setNewVersion(e.target.value)} />
              </label>
            </div>
          )}
          <div className="row wrap">
            <label className="field compact">
              <span>Section (optional)</span>
              <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. 4.2" />
            </label>
            <label className="field compact">
              <span>Page (optional)</span>
              <input value={page} onChange={(e) => setPage(e.target.value)} placeholder="e.g. 12" />
            </label>
          </div>
          {error && (
            <p className="error" id={errId} role="alert">
              {error}
            </p>
          )}
          <div className="row wrap">
            <button type="submit" className="btn primary">
              {bar ? "Update" : "Start answering from this document"}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setOpen(false);
                toggleRef.current?.focus();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
