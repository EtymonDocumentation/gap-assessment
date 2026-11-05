import { historyOf, historyUsage, limitMessage, removalLine, REASON_MAX, REASON_MIN, reviewProgress } from "@gap/engine";
import type { VersionEntry } from "@gap/process-model";
import { useId, useRef, useState } from "react";
import { PageHeader } from "../PageHeader";
import { Modal } from "../components";
import { href, navigate } from "../router";
import { READ_ONLY_MESSAGE, useStore } from "../store";
import { dayOf, SaveVersionButton, stageName, stageWords, useRealProject, useUnsaved, workingCopyText } from "../version-ui";

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Asks why a version is removed. ANY version can go (nothing in the history may be undeletable), after this confirm and a reason that is
 * written to the change log. Removing a version never changes the working project or its stage: only the frozen copy is dropped.
 */
function RemoveDialog({ entry, onClose, restoreFocus }: { entry: VersionEntry | null; onClose: () => void; restoreFocus: () => HTMLElement | null }) {
  const removeVersionNow = useStore((s) => s.removeVersionNow);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const reasonId = useId();
  const errId = useId();
  const close = () => {
    setReason("");
    setError("");
    onClose();
  };
  return (
    <Modal
      open={!!entry}
      onOpenChange={(o) => !o && close()}
      title={entry ? `Remove ${entry.label}?` : "Remove a version"}
      description="Only this saved copy is dropped. Your working project and its stage do not change. The removal is written to the change log."
      restoreFocus={restoreFocus}
    >
      {entry && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            // The dialog is a portal inside the page tree: without this a submit here would also reach a surrounding form (the interview question).
            e.stopPropagation();
            const why = reason.trim();
            if (why.length < REASON_MIN) {
              setError(`Say why this version is removed (at least ${REASON_MIN} characters).`);
              return;
            }
            const problem = removeVersionNow(entry.id, why);
            if (problem) setError(problem);
            else close();
          }}
        >
          <label className="field" htmlFor={reasonId}>
            <span>Why is {entry.label} removed?</span>
            <textarea id={reasonId} rows={2} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={error ? errId : undefined} autoFocus />
          </label>
          {error && (
            <p className="error" role="alert" id={errId}>
              {error}
            </p>
          )}
          <div className="row wrap">
            <button type="submit" className="btn danger">
              Remove {entry.label}
            </button>
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Saved copies of the project, newest first, with who saved each and why; open one read-only, save a new one, or remove one. */
export function VersionsPage() {
  const project = useRealProject()!;
  const viewing = useStore((s) => s.viewing);
  const openVersion = useStore((s) => s.openVersion);
  const unsaved = useUnsaved();
  const [removing, setRemoving] = useState<VersionEntry | null>(null);
  const [problem, setProblem] = useState("");
  const removeFocus = useRef<HTMLElement | null>(null);

  const history = historyOf(project);
  const usage = historyUsage(project);
  const entries = [...history.entries].reverse();
  const removed = history.removed ?? [];

  const open = async (id: string) => {
    setProblem("");
    const err = await openVersion(id);
    if (err) setProblem(err);
    else navigate("/");
  };

  return (
    <div className="stack-lg version-page">
      <PageHeader
        title="Version history"
        purpose="A version is a saved copy of the whole project. Open one to look at it (nothing in it can be changed), save a new one, or remove one you no longer need."
        actions={<SaveVersionButton className="btn primary" />}
      />

      <section className="card stack" aria-labelledby="versions-now-h">
        <h2 id="versions-now-h">Working copy</h2>
        <p data-testid="working-copy-line">
          <strong>{workingCopyText(project, unsaved)}</strong>
        </p>
        <p className="small muted">The working copy is the project you are editing now. A stage change saves a new main version (v2, v3); Save a version saves a smaller step (v2.1).</p>
        {viewing && (
          <p className="notice" data-testid="versions-viewing-note">
            {viewing.label} is open to look at. {READ_ONLY_MESSAGE}
          </p>
        )}
        {usage.atLimit ? (
          <p className="notice" role="status" data-testid="version-size-notice">
            {limitMessage(project)}
          </p>
        ) : (
          usage.nearLimit && (
            <p className="notice" role="status" data-testid="version-size-notice">
              The saved versions already use {usage.count} of {usage.maxVersions} versions and {mb(usage.bytes)} of {mb(usage.maxBytes)}. When the limit is reached you cannot save another until you remove one.
            </p>
          )
        )}
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
      </section>

      <section className="card stack" aria-labelledby="versions-list-h">
        <h2 id="versions-list-h">Saved versions ({entries.length})</h2>
        {entries.length === 0 ? (
          <p className="muted">No version is saved yet.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="Saved versions table" tabIndex={0}>
            <table className="data history-table" data-testid="version-table">
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Date</th>
                  <th scope="col">Who</th>
                  <th scope="col">Project stage</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Stage review</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const review = history.reviews.find((r) => r.versionId === e.id);
                  const progress = review ? reviewProgress(review) : null;
                  const isViewed = viewing?.entryId === e.id;
                  return (
                    <tr key={e.id} data-testid={`version-row-${e.label}`}>
                      <th scope="row" data-label="Version">
                        {e.label}
                        {e.kind === "start" && <span className="tag">Start</span>}
                      </th>
                      <td data-label="Date" style={{ whiteSpace: "nowrap" }}>{dayOf(e.at)}</td>
                      <td data-label="Who">{e.by}</td>
                      <td data-label="Project stage">{e.kind === "stage-change" ? stageWords(e.stage, e.fromStage, true) : stageName(e.stage)}</td>
                      <td data-label="Reason">{e.reason || <span className="muted">No note</span>}</td>
                      <td data-label="Stage review">
                        {progress ? (
                          <a href={href("/stage-review")}>
                            Stage review {progress.done} of {progress.total}
                          </a>
                        ) : (
                          <span className="muted">None</span>
                        )}
                      </td>
                      <td data-label="Actions">
                        <div className="row wrap">
                          {isViewed ? (
                            <span className="tag">Open now</span>
                          ) : (
                            <button type="button" className="btn small" onClick={() => void open(e.id)}>
                              Open read-only<span className="visually-hidden"> {e.label}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn small danger"
                            disabled={!!viewing}
                            title={viewing ? READ_ONLY_MESSAGE : undefined}
                            onClick={(ev) => {
                              removeFocus.current = ev.currentTarget;
                              setRemoving(e);
                            }}
                          >
                            Remove<span className="visually-hidden"> {e.label}</span>…
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {removed.length > 0 && (
          <div className="stack" data-testid="removed-versions">
            <h3>Removed versions</h3>
            <ul className="plain-list">
              {removed.map((r, i) => (
                <li key={`${r.label}-${i}`}>{removalLine(r)}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <RemoveDialog entry={removing} onClose={() => setRemoving(null)} restoreFocus={() => removeFocus.current} />
    </div>
  );
}
