import { samplingImportSynonyms } from "@gap/content";
import {
  applySamplingImport,
  checkSamplingValue,
  CONFIDENCE_LABEL,
  currentPointText,
  findTargetPoint,
  importSummaryText,
  SAMPLING_COLUMN_LABEL,
  SAMPLING_COLUMNS,
  SamplingImportError,
  samplingCounts,
  stepNamesFor,
  unitOpLabels,
  type SamplingColumn,
  type SamplingDecisions,
  type SamplingField,
  type SamplingImportSession,
} from "@gap/engine";
import { SAMPLING_TYPES } from "@gap/process-model";
import { TYPE_LABEL } from "@gap/sampling";
import { Fragment, useMemo, useRef, useState } from "react";
import { Empty } from "../components";
import { PageHeader } from "../PageHeader";
import { holdSamplingImport, useHeldSamplingImport } from "../sampling-import-store";
import { href, navigate } from "../router";
import * as api from "../server/api";
import { SERVER_MODE } from "../server/mode";
import { StageChangeButton, useProjectStage } from "../stage-ui";
import { useContent, useStore } from "../store";
import { ImportDocPane } from "./ImportDocPane";
import { SamplingFormButton, SamplingUploadButton } from "./SamplingUploadButton";

/**
 * The review screen of "Upload a sampling plan" (levels 1 to 3). One ROW per sampling point, six values in it (step, attribute, test,
 * amount, timing, type). Nothing reaches a plan until it is accepted here; what nobody accepts stays open. On a phone every row stacks
 * into one short block, and the document it was read from sits below the rows.
 */

type Target = "" | "new" | string;

interface Done {
  planId: string;
  text: string;
  detail: string;
  warnings: string[];
  copy: string;
}

export function SamplingImportPage() {
  const held = useHeldSamplingImport();
  if (!held) {
    return (
      <div className="stack-lg">
        <PageHeader title="Upload a sampling plan" purpose="Read a sampling plan you already have, check what was found, and make it a plan of this project." />
        <section className="card stack" data-testid="import-none">
          <Empty>No file is open. Choose a sampling plan file to start.</Empty>
          <div className="row wrap">
            <SamplingUploadButton testId="import-upload" />
          </div>
        </section>
      </div>
    );
  }
  return <Review key={held.session.fileName + held.file.size} session={held.session} file={held.file} />;
}

const closeUpload = () => {
  holdSamplingImport(null);
  navigate("/sampling");
};

function Review({ session, file }: { session: SamplingImportSession; file: File }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const content = useContent();
  const { stage } = useProjectStage();
  const plans = project.sampling.plans;
  const [decisions, setDecisions] = useState<SamplingDecisions>({});
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>(plans.length === 0 ? "new" : "");
  const [title, setTitle] = useState("");
  const [keepCopy, setKeepCopy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [bulk, setBulk] = useState("");
  // On a wide screen the document sits beside the rows. On a phone it is long, so it starts closed below them.
  const [docOpen, setDocOpen] = useState(() => typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 1000px)").matches);
  const docPane = useRef<HTMLDivElement>(null);

  const updating = target !== "" && target !== "new" ? plans.find((p) => p.id === target) : undefined;
  const labels = useMemo(() => unitOpLabels(content, project), [content, project]);
  const counts = useMemo(() => samplingCounts(session, decisions), [session, decisions]);
  const byId = useMemo(() => new Map(session.fields.map((f) => [f.id, f])), [session]);
  const stepNames = useMemo(() => stepNamesFor(content, project, updating), [content, project, updating]);
  const fieldsOf = (n: number) => SAMPLING_COLUMNS.map((c) => session.fields.find((f) => f.row === n && f.column === c)!);

  /** What the plan says now for a field (update mode): the target point's value. */
  const nowOf = (f: SamplingField) => {
    if (!updating || f.column === "title") return undefined;
    const row = session.rows.find((r) => r.n === f.row)!;
    return currentPointText(updating, findTargetPoint(updating, session, row, labels, project.meta.id), f.column, labels);
  };
  /** A suggestion can be taken in bulk when it is readable, not decided yet, and (update mode) would not replace something the plan already says. */
  const bulkable = (f: SamplingField, kinds: ("exact" | "matched")[]): boolean => {
    if (decisions[f.id] || f.change || f.unreadable || f.value === "" || !kinds.includes(f.confidence as "exact" | "matched")) return false;
    const now = nowOf(f);
    return !now || !now.exists || now.text === "" ;
  };
  const exactCount = session.fields.filter((f) => bulkable(f, ["exact"])).length;
  const matchedIn = (block: number) => session.fields.filter((f) => f.table === block && bulkable(f, ["matched"]));

  const set = (id: string, value: string) => setDecisions((d) => ({ ...d, [id]: { value } }));
  const clear = (id: string) =>
    setDecisions((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
  const take = (fs: SamplingField[]) => setDecisions((d) => ({ ...d, ...Object.fromEntries(fs.map((f) => [f.id, { value: f.value }])) }));

  function saveEdit() {
    if (!editing) return;
    const f = byId.get(editing.id)!;
    const text = editing.text.replace(/\s+/g, " ").trim();
    const why = f.column === "title" ? undefined : checkSamplingValue(f.column, text, samplingImportSynonyms);
    if (why) return setError(`${f.label}: ${why}`);
    setError("");
    if (text) set(f.id, text);
    else clear(f.id);
    setEditing(null);
  }

  function takeText(text: string) {
    if (!picking) return;
    const f = byId.get(picking)!;
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    const why = f.column === "title" ? undefined : checkSamplingValue(f.column, clean, samplingImportSynonyms);
    if (why) setError(`${f.label}: ${why}`);
    else {
      setError("");
      set(picking, clean);
    }
    setPicking(null);
  }

  function showInDocument(id: string) {
    const key = session.fieldCells[id]?.[0];
    setDocOpen(true);
    requestAnimationFrame(() => {
      const el = key ? document.getElementById(`imp-cell-${key.replace(/:/g, "-")}`) : null;
      el?.scrollIntoView({ block: "center" });
      el?.focus();
    });
  }
  function showTable(block: number) {
    setDocOpen(true);
    requestAnimationFrame(() => {
      const el = document.getElementById(`imp-table-${block}`);
      el?.scrollIntoView({ block: "start" });
      el?.focus();
    });
  }

  function submit() {
    setError("");
    if (!target) return setError("Choose whether this makes a new sampling plan or updates one of this project's plans.");
    const newTitle = title.trim() || decisions["sampling.title"]?.value || "";
    if (target === "new" && !newTitle) return setError("Give the new plan a title, or use the title from the file.");
    let result: ReturnType<typeof applySamplingImport> | undefined;
    const err = update((p, actor) => {
      try {
        result = applySamplingImport(p, session, decisions, { actor, content, syn: samplingImportSynonyms, target: target === "new" ? { kind: "new", title: newTitle } : { kind: "update", planId: target } });
      } catch (e) {
        if (e instanceof SamplingImportError) throw new Error(e.message);
        throw e;
      }
      return result.project;
    }, `Sampling plan imported from ${session.fileName}`);
    if (err || !result) return setError(err || "The sampling plan could not be made.");
    const r = result;
    const finish = (copy: string) =>
      setDone({ planId: r.planId, text: importSummaryText(r.counts, session.level), detail: `${r.added} ${r.added === 1 ? "point" : "points"} added, ${r.updated} ${r.updated === 1 ? "point" : "points"} updated.`, warnings: r.warnings, copy });
    if (SERVER_MODE && keepCopy) {
      api.uploadMyFile(file, "", () => undefined).done.then(
        () => finish("A copy of the file was kept in My files."),
        (e: Error) => finish(`The copy could not be kept in My files: ${e.message}`),
      );
    } else finish("");
  }

  if (done) {
    return (
      <div className="stack-lg">
        <PageHeader title="Upload a sampling plan" purpose="Done. The sampling plan is part of this project now." />
        <section className="card stack" data-testid="import-done" aria-labelledby="import-done-h">
          <h2 id="import-done-h">Sampling plan {done.planId}</h2>
          <p data-testid="import-summary" role="status">
            {done.text}
          </p>
          <p data-testid="import-added">{done.detail}</p>
          {done.copy && <p className="small">{done.copy}</p>}
          {done.warnings.length > 0 && (
            <div className="notice" data-testid="import-warnings">
              <strong>Left open:</strong>
              <ul className="plain-list">
                {done.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="row wrap">
            <a className="btn primary" href={href("/sampling", { plan: done.planId })} data-testid="import-open-plan">
              Open the sampling plan
            </a>
          </div>
          {!stage && (
            <div className="notice stack" data-testid="import-stage-question">
              <p>
                <strong>What stage is this project at?</strong> Some points are only taken in PPQ, so the plan follows the stage, and it is not set yet. Nothing is chosen for you.
              </p>
              <div>
                <StageChangeButton className="btn" label="Set the project stage">
                  Set the project stage
                </StageChangeButton>
              </div>
            </div>
          )}
          <div>
            <button type="button" className="btn ghost" onClick={closeUpload}>
              Close this upload
            </button>
          </div>
        </section>
      </div>
    );
  }

  const titleField = session.title;
  const titleDecided = decisions[titleField.id]?.value;

  function renderCell(f: SamplingField) {
    const decided = decisions[f.id];
    const now = nowOf(f);
    const isEditing = editing?.id === f.id;
    const col = f.column as SamplingColumn;
    const headLabel = SAMPLING_COLUMN_LABEL[col];
    if (isEditing) {
      const common = { id: `edit-${f.id}`, value: editing.text, onChange: (e: { target: { value: string } }) => setEditing({ id: f.id, text: e.target.value }) };
      return (
        <td data-label={headLabel} className="sp-import-cell">
          <label className="visually-hidden" htmlFor={common.id}>
            {headLabel}, row {f.row}
          </label>
          {col === "type" ? (
            <select {...common} data-testid="import-edit-input">
              <option value="">(choose a study type)</option>
              {SAMPLING_TYPES.map((k) => (
                <option key={k} value={TYPE_LABEL[k]}>
                  {TYPE_LABEL[k]}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input type="text" {...common} list={col === "step" ? "import-step-names" : undefined} data-testid="import-edit-input" />
            </>
          )}
          <span className="import-actions">
            <button type="button" className="btn small" onClick={saveEdit} data-testid="import-edit-save">
              Save
            </button>
            {session.level === 3 && (
              <button
                type="button"
                className="btn small ghost"
                onClick={() => {
                  setEditing(null);
                  setPicking(f.id);
                  setDocOpen(true);
                  docPane.current?.scrollIntoView({ block: "start" });
                }}
              >
                Pick from document
              </button>
            )}
            <button type="button" className="btn small ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </span>
        </td>
      );
    }
    if (f.change) {
      const state = decided === undefined ? "" : decided.value === "" ? "Kept the plan's value" : "Taken from the file";
      return (
        <td data-label={headLabel} className="sp-import-cell import-changed" data-testid="import-changed">
          <span className="tag status-partial status">{CONFIDENCE_LABEL.changed}</span>
          <span className="import-value">
            <span className="import-old">{f.change.old || "(empty)"}</span> <span className="import-new">{f.change.new || "(empty)"}</span>
          </span>
          {f.unreadable && <span className="import-cell-state">{f.unreadable}</span>}
          {state && <span className="import-cell-state" data-testid="import-state">{state}</span>}
          <span className="import-actions">
            <button type="button" className="btn small" disabled={!!f.unreadable} onClick={() => set(f.id, f.change!.new)} aria-label={`Use the file's ${headLabel}, row ${f.row}`} data-testid="import-use-file">
              Use the file's
            </button>
            <button type="button" className="btn small ghost" onClick={() => set(f.id, "")} aria-label={`Keep the plan's ${headLabel}, row ${f.row}`} data-testid="import-keep">
              Keep the plan's
            </button>
            <button type="button" className="btn small ghost" onClick={() => setEditing({ id: f.id, text: f.change!.new })} aria-label={`Edit ${headLabel}, row ${f.row}`}>
              Edit
            </button>
            {decided !== undefined && (
              <button type="button" className="btn small ghost" onClick={() => clear(f.id)}>
                Undo
              </button>
            )}
          </span>
        </td>
      );
    }
    const shown = decided?.value ?? f.value;
    return (
      <td data-label={headLabel} className="sp-import-cell" data-testid={`import-cell-${col}`}>
        <span className="import-value">{shown || <span className="muted">Not established</span>}</span>
        <span className="import-word">
          <span className="tag">{decided ? (decided.value === f.value ? "Accepted" : "Accepted (edited)") : f.value ? CONFIDENCE_LABEL[f.confidence] : CONFIDENCE_LABEL.not_found}</span>
        </span>
        {!decided && f.unreadable && <span className="import-cell-state">Cannot be taken as it stands: {f.unreadable}</span>}
        {!decided && f.notUsedWhy && <span className="import-cell-state" data-testid="import-not-used-why">{f.notUsedWhy}</span>}
        {now?.exists && now.text !== "" && now.text !== shown && <span className="import-cell-state">The plan has: {now.text}</span>}
        {now?.exists && now.text !== "" && now.text === shown && <span className="import-cell-state">Same as the plan</span>}
        <span className="import-actions">
          {decided ? (
            <button type="button" className="btn small ghost" onClick={() => clear(f.id)} aria-label={`Undo ${headLabel}, row ${f.row}`}>
              Undo
            </button>
          ) : (
            <>
              {f.value !== "" && (
                <button type="button" className="btn small" disabled={!!f.unreadable} onClick={() => set(f.id, f.value)} aria-label={`Accept ${headLabel}, row ${f.row}: ${f.value}`} data-testid="import-accept">
                  Accept
                </button>
              )}
              <button type="button" className="btn small ghost" onClick={() => setEditing({ id: f.id, text: f.value })} aria-label={`${f.value ? "Edit" : "Type"} ${headLabel}, row ${f.row}`}>
                {f.value ? "Edit" : "Type"}
              </button>
              {session.fieldCells[f.id] && (
                <button type="button" className="btn small ghost" onClick={() => showInDocument(f.id)} aria-label={`Show ${headLabel}, row ${f.row} in the document`}>
                  Show
                </button>
              )}
            </>
          )}
        </span>
      </td>
    );
  }

  return (
    <div className="stack-lg" data-testid="import-review">
      <PageHeader
        title="Upload a sampling plan"
        purpose={`Check what was read from ${session.fileName}. Nothing goes into a plan until you accept it; what you leave alone stays open.`}
      />
      <section className="card stack" aria-labelledby="import-what-h">
        <h2 id="import-what-h">What was read</h2>
        <p data-testid="import-read-as">{session.readAs}</p>
        <p className="muted small" data-testid="import-explain">
          {session.level === 3
            ? "Each row below is one sampling point found in your document. Every value marked Matched is a suggestion from fixed word rules (no AI): check it against the document, then accept it, edit it, or pick another value from the document. Not found means nothing was recognised and the value stays open."
            : "Each row below is one sampling point. Accept a value, edit it, or leave it open. The word under a value says how sure the reading is: Exact (read straight from our own data), or Changed in Word (somebody typed over it in the file)."}
        </p>
        <p role="status" aria-live="polite" data-testid="import-live-summary">
          {importSummaryText(counts, session.level)}
        </p>
        {session.notUsed.length > 0 && (
          <details className="notice import-not-used" open={session.notUsed.length <= 8} data-testid="import-not-used">
            <summary>
              <strong>Not used yet ({session.notUsed.length}):</strong> things in your document that were not put into the plan
            </summary>
            <ul className="plain-list">
              {session.notUsed.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        )}
        {session.level === 3 && (session.matchedTables?.length ?? 0) > 0 && (
          <div className="stack" data-testid="import-matched-tables">
            <h3>Tables with matches</h3>
            <p className="muted small">Look at the table in your document, then accept everything matched in it with one press, or accept value by value below.</p>
            <ul className="plain-list import-table-list">
              {session.matchedTables!.map((t) => {
                const n = matchedIn(t.block).length;
                return (
                  <li key={t.block} className="row wrap" data-testid="import-matched-table">
                    <span>{t.label}</span>
                    <button
                      type="button"
                      className="btn small"
                      disabled={n === 0}
                      onClick={() => {
                        take(matchedIn(t.block));
                        setBulk(`${n} matched ${n === 1 ? "value" : "values"} from ${t.label} accepted.`);
                      }}
                      aria-label={`Accept all matched in this table (${n}): ${t.label}`}
                      data-testid="import-accept-table"
                    >
                      Accept all matched in this table ({n})
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => showTable(t.block)} aria-label={`Show table: ${t.label}`}>
                      Show table
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="row wrap">
          {session.level !== 3 && (
            <button
              type="button"
              className="btn"
              disabled={exactCount === 0}
              onClick={() => {
                take(session.fields.filter((f) => bulkable(f, ["exact"])));
                setBulk(`${exactCount} exact ${exactCount === 1 ? "value" : "values"} accepted.`);
              }}
              data-testid="import-accept-exact"
            >
              Accept all exact ({exactCount})
            </button>
          )}
          <span role="status" aria-live="polite" className="small" data-testid="import-bulk-status">
            {bulk}
          </span>
        </div>
      </section>

      <div className="import-panes sp-import-panes">
        <section className="import-fields stack" aria-labelledby="import-fields-h" data-testid="import-fields">
          <h2 id="import-fields-h">Sampling points</h2>
          {session.rows.length === 0 ? (
            <Empty>No sampling point was found. Use "Not used yet" above to see why, or fill in the blank sampling plan form.</Empty>
          ) : (
            <div className="table-scroll" role="region" aria-label="Sampling points read from the file" tabIndex={0}>
              <table className="data sp-import-table" data-testid="import-rows">
                <thead>
                  <tr>
                    <th scope="col">Point</th>
                    {SAMPLING_COLUMNS.map((c) => (
                      <th key={c} scope="col">
                        {SAMPLING_COLUMN_LABEL[c]}
                      </th>
                    ))}
                    <th scope="col">Whole row</th>
                  </tr>
                </thead>
                <tbody>
                  {session.rows.map((r) => {
                    const fs = fieldsOf(r.n);
                    const takeKinds: ("exact" | "matched")[] = session.level === 3 ? ["matched"] : ["exact"];
                    const rowTake = fs.filter((f) => bulkable(f, takeKinds));
                    return (
                      <tr key={r.n} data-testid="import-row">
                        <th scope="row" className="sp-import-point" data-label="Point" title={r.where}>
                          {r.label}
                          {r.where && <span className="import-cell-state sp-import-where">{r.where}</span>}
                        </th>
                        {fs.map((f) => (
                          <Fragment key={f.id}>{renderCell(f)}</Fragment>
                        ))}
                        <td data-label="Whole row" className="sp-import-cell">
                          <button
                            type="button"
                            className="btn small"
                            disabled={rowTake.length === 0}
                            onClick={() => {
                              take(rowTake);
                              setBulk(`${rowTake.length} ${rowTake.length === 1 ? "value" : "values"} of ${r.label} accepted.`);
                            }}
                            aria-label={`Accept row (${rowTake.length}): ${r.label}`}
                            data-testid="import-accept-row"
                          >
                            Accept row ({rowTake.length})
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <datalist id="import-step-names">
            {stepNames.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </section>

        <ImportDocPane
          blocks={session.blocks}
          cellFields={session.cellFields}
          anyChanged={(ids) => ids.some((id) => byId.get(id)?.change)}
          picking={picking ? `${SAMPLING_COLUMN_LABEL[byId.get(picking)!.column as SamplingColumn] ?? "title"}, ${byId.get(picking)!.row ? `row ${byId.get(picking)!.row}` : "plan title"}` : null}
          onTake={takeText}
          onCancelPick={() => setPicking(null)}
          open={docOpen}
          setOpen={setDocOpen}
          innerRef={docPane}
        />
      </div>

      <section className="card stack" aria-labelledby="import-make-h" data-testid="import-make">
        <h2 id="import-make-h">Make the sampling plan</h2>
        {plans.length > 0 && (
          <fieldset className="stack">
            <legend>This project already has {plans.length === 1 ? "a sampling plan" : "sampling plans"}. What should this upload do?</legend>
            <label className="check">
              <input type="radio" name="import-target" checked={target === "new"} onChange={() => setTarget("new")} data-testid="import-target-new" />
              <span>Make a new sampling plan</span>
            </label>
            {plans.map((p) => (
              <label key={p.id} className="check">
                <input type="radio" name="import-target" checked={target === p.id} onChange={() => setTarget(p.id)} data-testid={`import-target-${p.id}`} />
                <span>
                  Update {p.id}: {p.title}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {updating && <p className="muted small">Only the values you accept are changed. A value the plan already has is replaced only if you accept the file's value for it, one by one.</p>}
        {target === "new" && (
          <div className="stack">
            <label className="field">
              <span>Title of the new plan</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="import-title" />
            </label>
            {titleField.value && (
              <div className="row wrap">
                <span className="small">
                  The file's title: <strong>{titleField.value}</strong> <span className="tag">{CONFIDENCE_LABEL[titleField.confidence]}</span>
                </span>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setTitle(titleField.value);
                    set(titleField.id, titleField.value);
                  }}
                  data-testid="import-use-title"
                >
                  Use this title
                </button>
                {titleDecided && <span className="small">Used.</span>}
              </div>
            )}
          </div>
        )}
        {SERVER_MODE && (
          <label className="check">
            <input type="checkbox" checked={keepCopy} onChange={(e) => setKeepCopy(e.target.checked)} data-testid="import-keep-copy" />
            <span>Keep a copy in My files</span>
          </label>
        )}
        {!SERVER_MODE && <p className="muted small">The file was read in your browser and has not been sent anywhere.</p>}
        {error && (
          <p className="error" role="alert" data-testid="import-error">
            {error}
          </p>
        )}
        <div className="row wrap">
          <button type="button" className="btn primary" onClick={submit} data-testid="import-create">
            {updating ? `Update ${updating.id}` : "Make the sampling plan"}
          </button>
          <button type="button" className="btn ghost" onClick={closeUpload}>
            Cancel
          </button>
          <SamplingFormButton testId="import-blank-form" className="btn ghost" />
        </div>
      </section>
    </div>
  );
}
