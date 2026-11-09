import { excipientClasses } from "@gap/content";
import { addLibraryLines, applyLibraryChanges, compareLineToLibrary, createExcipientAssessment, editLibraryRecord, findLibraryMatch, libraryIdFor, libraryRecordFromLine } from "@gap/engine";
import type { ExcipientAssessment, ExcipientLibraryRecord, ExcipientLine } from "@gap/process-model";
import { useMemo, useState } from "react";
import { EXCIPIENT_PATH, classText } from "../excipient-ui";
import { useExcipientLibrary, useExcipientRecords } from "../excipient-library-store";
import { countOf } from "../lib";
import { href, navigate } from "../router";
import { useStore } from "../store";
import { libraryActor } from "./ExcipientLibraryPage";

const classKeys = excipientClasses.classes.map((c) => c.key);
const classLabelOf = (k: string): string => excipientClasses.classes.find((c) => c.key === k)?.label ?? k;

/**
 * "Start from the library" on the list page: tick one or more saved excipients and make a new assessment with those lines. Each line
 * gets the saved name, role and tests; every answer stays empty. Nothing is ticked at first.
 */
export function StartFromLibrary({ onClose }: { onClose: () => void }) {
  const { items, ready } = useExcipientRecords();
  const update = useStore((s) => s.update);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");

  function make() {
    const chosen = items.filter((r) => picked.includes(r.id));
    let newId = "";
    const err = update((p, actor) => {
      const made = createExcipientAssessment(p, { title: `${p.meta.title} excipient assessment` }, actor);
      newId = made.assessmentId;
      return addLibraryLines(made.project, made.assessmentId, chosen, actor, { classKeys }).project;
    }, "Excipient assessment created from the library");
    if (err) return setError(err);
    navigate(EXCIPIENT_PATH, { excipient: newId, tab: "excipients" });
  }

  return (
    <section className="card stack" aria-labelledby="ex-lib-pick-h" data-testid="ex-lib-picker">
      <h3 id="ex-lib-pick-h">Pick the excipients to start with</h3>
      {!ready ? (
        <p className="muted">Loading the saved excipients.</p>
      ) : items.length === 0 ? (
        <p data-testid="ex-lib-none">
          Your library has no saved excipients yet. You can <a href={href("/excipient/library")}>add one in the library</a>, or open an excipient in an assessment and choose "Save to the library".
        </p>
      ) : (
        <fieldset className="fs stack">
          <legend>Saved excipients ({items.length})</legend>
          {items.map((r) => (
            <label key={r.id} className="check" data-testid={`ex-lib-item-${r.id}`}>
              <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))} />
              <span>
                {r.name} <span className="muted small">({classText(r) ?? "role not chosen"}, {countOf(r.tests.length, "test")})</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {error && (
        <p className="error" role="alert" data-testid="ex-lib-error">
          {error}
        </p>
      )}
      <div className="row wrap">
        {items.length > 0 && (
          <button type="button" className="btn primary" disabled={picked.length === 0} data-testid="ex-lib-make" onClick={make}>
            {picked.length === 0 ? "Make the assessment" : `Make the assessment with ${countOf(picked.length, "excipient")}`}
          </button>
        )}
        <button type="button" className="btn" onClick={onClose} data-testid="ex-lib-cancel">
          Cancel
        </button>
      </div>
    </section>
  );
}

/**
 * On an excipient's page: "Save to the library" and "Update from library". The assessment keeps no link to the library (so nothing about
 * the library is stored in the project file): the saved excipient with the same name is offered first, and any other can be chosen.
 */
export function ExcipientLibraryBox({ a, line }: { a: ExcipientAssessment; line: ExcipientLine }) {
  const { items, ready } = useExcipientRecords();
  const save = useExcipientLibrary((s) => s.save);
  const [panel, setPanel] = useState<"" | "save" | "update">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const match = findLibraryMatch(items, line.name);

  async function saveRecord(asNew: boolean) {
    setError("");
    try {
      const now = new Date().toISOString();
      const fresh = libraryRecordFromLine(line, match && !asNew ? match.id : libraryIdFor(line.name, items.map((r) => r.id)), now, libraryActor());
      // A new version of the saved one keeps the prompts the team wrote there; the line itself has no prompts to give.
      const record =
        match && !asNew
          ? editLibraryRecord(match, { name: fresh.name, classKey: fresh.classKey, classLabel: fresh.classLabel, tests: fresh.tests, prompts: match.prompts }, now, libraryActor())
          : fresh;
      await save(record);
      setMessage(record === match ? "The saved excipient already matches this one, so no new version was made." : `Saved to the library as version ${record.version}.`);
      setPanel("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card stack no-print" aria-labelledby="ex-line-lib-h" data-testid="ex-line-library">
      <h2 id="ex-line-lib-h">Excipient library</h2>
      <p className="muted small">The library keeps the name, the role and the list of tests, never the answers. {match ? `A saved excipient called ${match.name} exists (version ${match.version}).` : ""}</p>
      <div className="row wrap">
        <button type="button" className="btn" aria-expanded={panel === "save"} data-testid="ex-line-lib-save" onClick={() => setPanel(panel === "save" ? "" : "save")}>
          Save to the library
        </button>
        <button type="button" className="btn" aria-expanded={panel === "update"} data-testid="ex-line-lib-update" onClick={() => setPanel(panel === "update" ? "" : "update")}>
          Update from library
        </button>
        <a className="btn" href={href("/excipient/library")} data-testid="ex-line-lib-open">
          Open the library
        </a>
      </div>
      <div role="status" aria-live="polite">
        {message && <p data-testid="ex-line-lib-message">{message}</p>}
      </div>
      {error && (
        <p className="error" role="alert" data-testid="ex-line-lib-error">
          {error}
        </p>
      )}

      {panel === "save" && (
        <div className="stack" data-testid="ex-line-lib-save-panel">
          <p>
            {line.name}, {classText(line) ?? "role not chosen"}, {countOf(line.specs.length, "test")}.
          </p>
          {match ? (
            <>
              <p>A saved excipient with this name is in the library. You can add this as its next version, or save it as a separate one.</p>
              <div className="row wrap">
                <button type="button" className="btn primary" data-testid="ex-line-lib-save-version" onClick={() => void saveRecord(false)}>
                  Save as version {match.version + 1}
                </button>
                <button type="button" className="btn" data-testid="ex-line-lib-save-new" onClick={() => void saveRecord(true)}>
                  Save as a separate one
                </button>
              </div>
            </>
          ) : (
            <div className="row wrap">
              <button type="button" className="btn primary" disabled={!ready} data-testid="ex-line-lib-save-new" onClick={() => void saveRecord(true)}>
                Save to the library
              </button>
            </div>
          )}
        </div>
      )}
      {panel === "update" && <UpdateFromLibrary a={a} line={line} records={items} ready={ready} match={match} onDone={(text) => { setMessage(text); setPanel(""); }} />}
    </section>
  );
}

/** What the saved excipient says that this one does not, item by item. Every item starts on "Keep mine"; nothing changes until it is chosen. */
function UpdateFromLibrary({ a, line, records, ready, match, onDone }: { a: ExcipientAssessment; line: ExcipientLine; records: ExcipientLibraryRecord[]; ready: boolean; match: ExcipientLibraryRecord | undefined; onDone: (text: string) => void }) {
  const update = useStore((s) => s.update);
  const [recordId, setRecordId] = useState(match?.id ?? "");
  const [use, setUse] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const record = records.find((r) => r.id === recordId);
  const changes = useMemo(() => (record ? compareLineToLibrary(line, record, classLabelOf) : []), [line, record]);
  const chosen = changes.filter((c) => use[c.key]).map((c) => c.key);

  function apply() {
    if (!record) return;
    const err = update((p, actor) => applyLibraryChanges(p, a.id, line.id, record, chosen, actor, { classKeys }), "Updated from the library");
    if (err) return setError(err);
    onDone(chosen.length === 0 ? "Nothing was changed." : `Updated from the library: ${countOf(chosen.length, "change")} applied.`);
  }

  return (
    <div className="stack" data-testid="ex-line-lib-update-panel">
      {!ready ? (
        <p className="muted">Loading the saved excipients.</p>
      ) : records.length === 0 ? (
        <p data-testid="ex-lib-none">Your library has no saved excipients yet.</p>
      ) : (
        <label className="field">
          <span>Compare with this saved excipient</span>
          <select
            value={recordId}
            onChange={(e) => {
              setRecordId(e.target.value);
              setUse({});
            }}
            data-testid="ex-lib-source"
          >
            <option value="">Choose…</option>
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (version {r.version})
              </option>
            ))}
          </select>
        </label>
      )}
      {record && changes.length === 0 && <p data-testid="ex-lib-nochange">This excipient already has everything the saved one has. Nothing to update.</p>}
      {record && changes.length > 0 && (
        <>
          <p>
            {countOf(changes.length, "difference")} from the saved one (version {record.version}). Your own values are kept unless you choose the library's.
          </p>
          <ul className="plain-list ex-lib-changes" data-testid="ex-lib-changes">
            {changes.map((c) => (
              <li key={c.key}>
                <fieldset className="fs stack" data-testid={`ex-lib-change-${c.key}`}>
                  <legend>{c.label}</legend>
                  <p className="small">
                    {c.kind === "test_added" ? (
                      <>The saved excipient has this test. This one does not.</>
                    ) : (
                      <>
                        Yours: <strong>{c.mine || "Not chosen"}</strong>. Library: <strong>{c.library}</strong>.
                      </>
                    )}
                  </p>
                  <div className="row wrap">
                    <label className="check">
                      <input type="radio" name={`lib-${c.key}`} checked={!use[c.key]} onChange={() => setUse((s) => ({ ...s, [c.key]: false }))} data-testid={`ex-lib-keep-${c.key}`} />
                      <span>{c.kind === "test_added" ? "Leave it out" : "Keep mine"}</span>
                    </label>
                    <label className="check">
                      <input type="radio" name={`lib-${c.key}`} checked={!!use[c.key]} onChange={() => setUse((s) => ({ ...s, [c.key]: true }))} data-testid={`ex-lib-change-use-${c.key}`} />
                      <span>{c.kind === "test_added" ? "Add the test" : "Use the library's"}</span>
                    </label>
                  </div>
                </fieldset>
              </li>
            ))}
          </ul>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div>
            <button type="button" className="btn primary" data-testid="ex-lib-apply" onClick={apply}>
              {chosen.length === 0 ? "Apply (nothing chosen)" : `Apply ${countOf(chosen.length, "change")}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
