import { excipientClasses } from "@gap/content";
import { editChangesRecord, editLibraryRecord, libraryIdFor, newLibraryRecord } from "@gap/engine";
import type { ExcipientLibraryRecord, ExcipientLibraryTest } from "@gap/process-model";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../PageHeader";
import { Empty } from "../components";
import { classText } from "../excipient-ui";
import { useExcipientLibrary } from "../excipient-library-store";
import { countOf, dateTime } from "../lib";
import { SERVER_MODE } from "../server/mode";
import { actorOf, useStore } from "../store";
import { ReasonDialog } from "./ReasonDialog";

/** Who saved a record: the open project's person, or a plain word when no project is open (the library works without one). */
export function libraryActor(): string {
  const p = useStore.getState().project;
  return p ? actorOf(p).name : "Unnamed user";
}

/**
 * The excipient library: the account's saved excipients (name, role, the tests worth comparing and the team's own prompts). It holds no
 * answers about a product. A saved excipient is versioned; a project keeps its own copy of anything it takes from here, so changing or
 * removing one here never changes a project.
 */
export function ExcipientLibraryPage() {
  const items = useExcipientLibrary((s) => s.items);
  const removed = useExcipientLibrary((s) => s.removed);
  const ready = useExcipientLibrary((s) => s.ready);
  const storeError = useExcipientLibrary((s) => s.error);
  const load = useExcipientLibrary((s) => s.load);
  const save = useExcipientLibrary((s) => s.save);
  const remove = useExcipientLibrary((s) => s.remove);
  useEffect(() => void load(), [load]);
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState<ExcipientLibraryRecord | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const editing = items.find((r) => r.id === editId);

  return (
    <div className="stack-lg" data-testid="exl-page">
      <PageHeader
        title="Excipient library"
        purpose="Your saved excipients: the name, the role and the tests worth comparing. Use them to start an assessment without typing them again."
        about={{
          art: "page-document",
          children: (
            <ul className="plain-list">
              <li>{SERVER_MODE ? "Your saved excipients are kept on the server for your account." : "Your saved excipients are kept in this browser, not in the project file."}</li>
              <li>A saved excipient holds no answers about a product: no supplier, no grade and no limit. You answer those in each assessment.</li>
              <li>An assessment keeps its own copy. Changing or removing a saved excipient here does not change any assessment.</li>
              <li>Each save of a change makes a new version, and the earlier versions stay in its history.</li>
            </ul>
          ),
        }}
      />

      {storeError && (
        <p className="notice" role="alert" data-testid="exl-error">
          {storeError}
        </p>
      )}
      <div role="status" aria-live="polite">
        {message && <p data-testid="exl-message">{message}</p>}
      </div>

      <section className="card stack" aria-labelledby="exl-list-h">
        <div className="row between wrap">
          <h2 id="exl-list-h">Saved excipients ({items.length})</h2>
          <button
            type="button"
            className="btn primary"
            data-testid="exl-new"
            onClick={() => {
              setEditId(null);
              setCreating(true);
              setMessage("");
            }}
          >
            New saved excipient
          </button>
        </div>
        {!ready ? (
          <Empty>Loading the saved excipients.</Empty>
        ) : items.length === 0 ? (
          <Empty>
            Nothing is saved yet. Add one here, or open an excipient in an assessment and choose "Save to the library".
          </Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Saved excipients table" tabIndex={0}>
            <table className="data" data-testid="exl-table">
              <thead>
                <tr>
                  <th scope="col">Excipient and role</th>
                  <th scope="col">Version</th>
                  <th scope="col">Tests</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} data-testid={`exl-row-${r.id}`}>
                    <th scope="row">
                      {r.name}
                      <span className="block muted small">
                        {classText(r) ?? "Role not chosen"}
                        {r.at ? `, saved ${dateTime(r.at)}` : ""}
                      </span>
                    </th>
                    <td className="num">{r.version}</td>
                    <td className="num">{r.tests.length}</td>
                    <td>
                      <span className="stack">
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`Open ${r.name}`}
                          data-testid={`exl-edit-${r.id}`}
                          onClick={(e) => {
                            opener.current = e.currentTarget;
                            setCreating(false);
                            setEditId(r.id);
                            setMessage("");
                          }}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`Remove ${r.name}`}
                          data-testid={`exl-remove-${r.id}`}
                          onClick={(e) => {
                            opener.current = e.currentTarget;
                            setRemoving(r);
                          }}
                        >
                          Remove
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

      {creating && (
        <RecordForm
          key="new"
          cur={undefined}
          onCancel={() => setCreating(false)}
          onSave={async (edit) => {
            const id = libraryIdFor(edit.name, items.map((x) => x.id));
            await save(newLibraryRecord(id, edit, new Date().toISOString(), libraryActor()));
            setCreating(false);
            setMessage(`"${edit.name.trim()}" saved to the library as version 1.`);
          }}
        />
      )}
      {editing && (
        <RecordForm
          key={editing.id}
          cur={editing}
          onCancel={() => {
            setEditId(null);
            setTimeout(() => opener.current?.focus(), 0);
          }}
          onSave={async (edit) => {
            if (!editChangesRecord(editing, edit)) {
              setMessage("Nothing changed, so no new version was made.");
              return;
            }
            const next = editLibraryRecord(editing, edit, new Date().toISOString(), libraryActor());
            await save(next);
            setEditId(null);
            setMessage(`"${next.name}" saved as version ${next.version}. Assessments keep their own copies; an excipient page can pick up the change with "Update from library".`);
            setTimeout(() => opener.current?.focus(), 0);
          }}
        />
      )}

      {!SERVER_MODE && removed.length > 0 && (
        <details className="card" data-testid="exl-removed">
          <summary>Removed from the library ({removed.length})</summary>
          <ul className="plain-list">
            {removed.map((r) => (
              <li key={`${r.at}|${r.id}`}>
                <strong>{r.name}</strong> (version {r.version}), removed {dateTime(r.at)}. Reason: {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {removing && (
        <ReasonDialog
          title="Remove this saved excipient?"
          description={`${removing.name} (version ${removing.version}) leaves the library. Assessments keep their own copies.`}
          confirmLabel="Remove from the library"
          keepLabel="Keep it"
          testId="exl-remove"
          restoreFocus={() => opener.current}
          onClose={() => setRemoving(null)}
          onConfirm={(reason) => {
            const r = removing;
            void remove(r, reason).then(
              () => setMessage(`"${r.name}" removed from the library. The reason is kept.`),
              () => undefined,
            );
            return null;
          }}
        />
      )}
    </div>
  );
}

interface FormValues {
  name: string;
  classKey?: string | undefined;
  classLabel?: string | undefined;
  tests: ExcipientLibraryTest[];
  prompts: string[];
}

/** The role choice, the tests (a name and an optional note each) and the team's own prompts, one per line. Nothing is chosen for the person. */
export function RecordForm({ cur, onSave, onCancel }: { cur: ExcipientLibraryRecord | undefined; onSave: (v: FormValues) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(cur?.name ?? "");
  const [classKey, setClassKey] = useState(cur?.classKey ?? "");
  const [classLabel, setClassLabel] = useState(cur?.classLabel ?? "");
  const [tests, setTests] = useState<ExcipientLibraryTest[]>(cur?.tests ?? []);
  const [prompts, setPrompts] = useState((cur?.prompts ?? []).join("\n"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const setTest = (i: number, patch: Partial<ExcipientLibraryTest>) => setTests((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit() {
    if (!name.trim()) return setError("Give the excipient a name.");
    const seen = new Set<string>();
    for (const t of tests) {
      const k = t.test.trim().toLowerCase();
      if (!k) continue;
      if (seen.has(k)) return setError(`The test "${t.test.trim()}" is in the list twice. Keep it once.`);
      seen.add(k);
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        name,
        classKey: classKey || undefined,
        classLabel: classKey ? undefined : classLabel || undefined,
        tests: tests.filter((t) => t.test.trim()),
        prompts: prompts.split("\n"),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="exl-form-h" data-testid="exl-form">
      <h2 id="exl-form-h" tabIndex={-1} ref={heading}>
        {cur ? `${cur.name} (now version ${cur.version})` : "New saved excipient"}
      </h2>
      <label className="field">
        <span>Excipient name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Excipient A (fictional)" data-testid="exl-name" />
      </label>
      <div className="row wrap end-align">
        <label className="field">
          <span>What does it do in the product?</span>
          <select
            value={classKey}
            onChange={(e) => {
              setClassKey(e.target.value);
              if (e.target.value) setClassLabel("");
            }}
            data-testid="exl-class"
          >
            <option value="">Choose…</option>
            {excipientClasses.classes.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Or say it in your own words</span>
          <input
            value={classLabel}
            disabled={!!classKey}
            onChange={(e) => setClassLabel(e.target.value)}
            data-testid="exl-class-own"
            aria-describedby="exl-class-own-hint"
          />
          <span className="muted small" id="exl-class-own-hint">
            {classKey ? "Set the list to “Choose…” to write your own words." : "Used when no listed role fits."}
          </span>
        </label>
      </div>

      <fieldset className="fs stack" data-testid="exl-tests">
        <legend>Tests to compare ({tests.length})</legend>
        <p className="muted small">These become the rows of the specification table when you start an assessment from this excipient. The values stay empty.</p>
        {tests.length === 0 && <p className="muted small">No tests yet.</p>}
        {tests.map((t, i) => (
          <div key={i} className="row wrap end-align" data-testid={`exl-test-${i}`}>
            <label className="field grow">
              <span>Test {i + 1}</span>
              <input value={t.test} onChange={(e) => setTest(i, { test: e.target.value })} data-testid={`exl-test-name-${i}`} />
            </label>
            <label className="field grow">
              <span>Note (optional)</span>
              <input value={t.note ?? ""} onChange={(e) => setTest(i, { note: e.target.value })} data-testid={`exl-test-note-${i}`} />
            </label>
            <button type="button" className="btn small" aria-label={`Remove test ${t.test || i + 1} from this list`} onClick={() => setTests((rows) => rows.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <div>
          <button type="button" className="btn small" data-testid="exl-test-add" onClick={() => setTests((rows) => [...rows, { test: "" }])}>
            Add a test
          </button>
        </div>
      </fieldset>

      <label className="field">
        <span>Your own prompts (optional, one per line)</span>
        <textarea rows={3} value={prompts} onChange={(e) => setPrompts(e.target.value)} aria-describedby="exl-prompts-hint" data-testid="exl-prompts" />
        <span className="muted small" id="exl-prompts-hint">
          Other tests your team often compares for this excipient. On the Specifications tab of an excipient with this name they show as buttons; nothing is added until you pick one.
        </span>
      </label>

      {cur && (cur.history?.length ?? 0) > 0 && (
        <div className="stack">
          <button type="button" className="btn small" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)} data-testid="exl-history-toggle">
            {showHistory ? "Hide" : "Show"} earlier versions ({cur.history!.length})
          </button>
          {showHistory && (
            <ul className="plain-list" data-testid="exl-history">
              {[...cur.history!].reverse().map((h) => (
                <li key={h.version}>
                  <strong>Version {h.version}</strong>: {h.name}, {countOf(h.tests.length, "test")}
                  {h.at ? `, saved ${dateTime(h.at)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert" data-testid="exl-form-error">
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} data-testid="exl-save" onClick={() => void submit()}>
          {cur ? "Save as a new version" : "Save to the library"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
