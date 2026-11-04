import {
  applyImport,
  cellTextReadable,
  currentValue,
  importCounts,
  importSummaryText,
  isExact,
  resolvedValues,
  TrdImportError,
  type ImportDecisions,
  type ImportField,
  type ImportSession,
} from "@gap/engine";
import { useMemo, useRef, useState } from "react";
import { Empty } from "../components";
import { PageHeader } from "../PageHeader";
import { href, navigate } from "../router";
import * as api from "../server/api";
import { SERVER_MODE } from "../server/mode";
import { useStore } from "../store";
import { StageChangeButton, useProjectStage } from "../stage-ui";
import { holdImport, useHeldImport } from "../trd-import-store";
import { useTrdWriteupLibrary } from "../trd-writeups-store";
import { ImportDocPane } from "./ImportDocPane";
import { isParamGroup, ParamTable, SimpleTable, type Editing, type ImportCtx } from "./TrdImportFields";
import { TrdUploadButton } from "./TrdUploadButton";

/**
 * The review screen of "Upload a TRD" (levels 1 and 2). Left: the document as read. Right: the fields. Nothing reaches a TRD until it is
 * accepted here, and a field nobody accepts stays NOT ESTABLISHED and shows up as an open item of the TRD.
 */

type Target = "" | "new" | string;

interface Done {
  trdId: string;
  text: string;
  warnings: string[];
  copy: string;
}

export function TrdImportPage() {
  const held = useHeldImport();
  if (!held) {
    return (
      <div className="stack-lg">
        <PageHeader title="Upload a TRD" purpose="Read a TRD you already have, check what was found, and make it a TRD of this project." />
        <section className="card stack" data-testid="import-none">
          <Empty>No file is open. Choose a TRD file to start.</Empty>
          <div className="row wrap">
            <TrdUploadButton testId="import-upload" />
          </div>
        </section>
      </div>
    );
  }
  return <Review key={held.session.fileName + held.file.size} session={held.session} file={held.file} />;
}

function Review({ session, file }: { session: ImportSession; file: File }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const library = useTrdWriteupLibrary();
  const { stage } = useProjectStage();
  const trds = project.trd.documents;
  const [decisions, setDecisions] = useState<ImportDecisions>({});
  const [editing, setEditing] = useState<Editing | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>(trds.length === 0 ? "new" : "");
  const [title, setTitle] = useState("");
  const [keepCopy, setKeepCopy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [bulk, setBulk] = useState("");
  // On a wide screen the document sits beside the fields. On a phone it is long, so it starts closed below the fields.
  const [docOpen, setDocOpen] = useState(() => typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 1000px)").matches);
  const docPane = useRef<HTMLDivElement>(null);

  const updating = target !== "" && target !== "new" ? trds.find((d) => d.id === target) : undefined;
  const counts = useMemo(() => importCounts(session, decisions), [session, decisions]);
  const values = useMemo(() => resolvedValues(session, decisions), [session, decisions]);
  const byId = useMemo(() => new Map(session.fields.map((f) => [f.id, f])), [session]);

  /** In update mode a value that is already what the TRD says, or that replaces the person's own override, is not taken in bulk. */
  const bulkable = (f: ImportField): boolean => {
    if (!isExact(f) || decisions[f.id]) return false;
    if (!updating) return true;
    const now = currentValue(updating, f.id);
    return !(now.exists && now.text === f.value) && !now.overridden;
  };
  const exactCount = session.fields.filter(bulkable).length;
  /**
   * A value the person can take with a row's or a table's Accept: an exact one, or (level 3) a MATCHED one. Matched values are
   * suggestions from word rules, so they are never part of "Accept all exact"; a row or a table is taken only by pressing its own button.
   */
  const takeable = (f: ImportField): boolean => {
    if (decisions[f.id] || f.lockedBy || f.value === "") return false;
    if (f.confidence !== "exact" && f.confidence !== "matched") return false;
    if (!updating) return true;
    const now = currentValue(updating, f.id);
    return !(now.exists && now.text === f.value) && !now.overridden;
  };
  const matchedIn = (block: number) => session.fields.filter((f) => f.table === block && f.confidence === "matched" && takeable(f));

  const set = (id: string, value: string) => setDecisions((d) => ({ ...d, [id]: { value } }));
  const clear = (id: string) =>
    setDecisions((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });

  function acceptAllExact() {
    const take = session.fields.filter(bulkable);
    setDecisions((d) => ({ ...d, ...Object.fromEntries(take.map((f) => [f.id, { value: f.value }])) }));
    setBulk(`${take.length} exact ${take.length === 1 ? "value" : "values"} accepted.`);
  }

  function takeText(text: string) {
    if (!picking) return;
    const f = byId.get(picking);
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (f?.change && !cellTextReadable(f.change.column, clean)) setError(`"${clean}" is not numbers the review can read in the ${f.change.column} column. Edit it instead.`);
    else setError("");
    if (!f?.change || cellTextReadable(f.change.column, clean)) set(picking, clean);
    setPicking(null);
  }

  function showInDocument(fieldId: string) {
    const key = session.fieldCells[fieldId]?.[0];
    setDocOpen(true);
    // The document may have been closed: wait one frame for it to open before looking for the cell.
    requestAnimationFrame(() => {
      const el = key ? document.getElementById(`imp-cell-${key.replace(/:/g, "-")}`) : null;
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.focus();
      }
    });
  }

  function submit() {
    setError("");
    if (!target) return setError("Choose whether this makes a new TRD or updates one of this project's TRDs.");
    const accepted = (id: string) => values.get(id);
    const newTitle = title.trim() || accepted("trd.title") || "";
    if (target === "new" && !newTitle) return setError("Give the new TRD a title, or accept the title from the file.");
    let result: ReturnType<typeof applyImport> | undefined;
    const err = update((p, actor) => {
      try {
        result = applyImport(p, session, decisions, { actor, target: target === "new" ? { kind: "new", title: newTitle } : { kind: "update", trdId: target }, library });
      } catch (e) {
        if (e instanceof TrdImportError) throw new Error(e.message);
        throw e;
      }
      return result.project;
    }, `TRD imported from ${session.fileName}`);
    if (err || !result) return setError(err || "The TRD could not be made.");
    const r = result;
    const finish = (copy: string) => setDone({ trdId: r.trdId, text: importSummaryText(r.counts, session.level), warnings: r.warnings, copy });
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
        <PageHeader title="Upload a TRD" purpose="Done. The TRD is part of this project now." />
        <section className="card stack" data-testid="import-done" aria-labelledby="import-done-h">
          <h2 id="import-done-h">TRD {done.trdId}</h2>
          <p data-testid="import-summary" role="status">
            {done.text}
          </p>
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
            <button type="button" className="btn primary" onClick={() => navigate("/mbr", { trd: done.trdId })} data-testid="import-start-mbr">
              Start the batch record from this TRD
            </button>
            <a className="btn" href={href("/trd", { trd: done.trdId })} data-testid="import-open-trd">
              Open the TRD
            </a>
          </div>
          {!stage && (
            <div className="notice stack" data-testid="import-stage-question">
              <p>
                <strong>What stage is this project at?</strong> The wording of the TRD follows the stage, and it is not set yet. Nothing is chosen for you.
              </p>
              <div>
                <StageChangeButton className="btn" label="Set the project stage">
                  Set the project stage
                </StageChangeButton>
              </div>
            </div>
          )}
          <div>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                holdImport(null);
                navigate("/trd");
              }}
            >
              Close this upload
            </button>
          </div>
        </section>
      </div>
    );
  }

  // Group the fields: the group (document, product and site, each process step), then the parameter.
  const groups: { name: string; subs: { name: string; fields: ImportField[] }[] }[] = [];
  for (const f of session.fields) {
    let g = groups.find((x) => x.name === f.group);
    if (!g) groups.push((g = { name: f.group, subs: [] }));
    const subName = f.sub ?? "";
    let s = g.subs.find((x) => x.name === subName);
    if (!s) g.subs.push((s = { name: subName, fields: [] }));
    s.fields.push(f);
  }

  const ctx: ImportCtx = {
    session,
    decisions,
    values,
    byId,
    now: (id) => (updating ? currentValue(updating, id) : undefined),
    editing,
    setEditing,
    bulkable,
    takeable,
    set,
    clear,
    pick: (id) => {
      setEditing(null);
      setPicking(id);
      setDocOpen(true);
      docPane.current?.scrollIntoView({ block: "start" });
    },
    show: showInDocument,
  };
  function acceptTable(block: number, label: string) {
    const take = matchedIn(block);
    setDecisions((d) => ({ ...d, ...Object.fromEntries(take.map((f) => [f.id, { value: f.value }])) }));
    setBulk(`${take.length} matched ${take.length === 1 ? "value" : "values"} from ${label} accepted.`);
  }
  function showTable(block: number) {
    setDocOpen(true);
    requestAnimationFrame(() => {
      const el = document.getElementById(`imp-table-${block}`);
      el?.scrollIntoView({ block: "start" });
      el?.focus();
    });
  }
  const stepAccept = (fields: ImportField[]) => {
    const take = fields.filter(bulkable);
    setDecisions((d) => ({ ...d, ...Object.fromEntries(take.map((f) => [f.id, { value: f.value }])) }));
    setBulk(`${take.length} exact ${take.length === 1 ? "value" : "values"} accepted.`);
  };

  return (
    <div className="stack-lg" data-testid="import-review">
      <PageHeader
        title="Upload a TRD"
        purpose={`Check what was read from ${session.fileName}. Nothing goes into a TRD until you accept it; what you leave alone stays not established and becomes an open item.`}
      />
      <section className="card stack" aria-labelledby="import-what-h">
        <h2 id="import-what-h">What was read</h2>
        <p data-testid="import-read-as">{session.readAs}</p>
        <p className="muted small" data-testid="import-explain">
          {session.level === 3
            ? "Two parts: your document as it was read, and the fields taken from it. Every value marked Matched is a suggestion from fixed word rules (no AI): check it against the document, then accept it, edit it, or pick another value from the document. Not found means nothing was recognised and the field stays open."
            : "Two parts: your document as it was read, and the fields taken from it. Accept a value, edit it, or pick it from the document. The word next to a field says how sure the reading is: Exact (read straight from our own data), Matched, or Not found."}
        </p>
        <p role="status" aria-live="polite" data-testid="import-live-summary">
          {importSummaryText(counts, session.level)}
        </p>
        {session.notUsed.length > 0 && (
          <details className="notice import-not-used" open={session.notUsed.length <= 8} data-testid="import-not-used">
            <summary>
              <strong>Not used yet ({session.notUsed.length}):</strong> text from your document that looks important and was not put into a field
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
            <p className="muted small">Look at the table in your document, then accept everything matched in it with one press, or accept row by row below.</p>
            <ul className="plain-list import-table-list">
              {session.matchedTables!.map((t) => {
                const n = matchedIn(t.block).length;
                return (
                  <li key={t.block} className="row wrap" data-testid="import-matched-table">
                    <span>{t.label}</span>
                    <button type="button" className="btn small" disabled={n === 0} onClick={() => acceptTable(t.block, t.label)} aria-label={`Accept all matched in this table (${n}): ${t.label}`} data-testid="import-accept-table">
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
            <button type="button" className="btn" onClick={acceptAllExact} disabled={exactCount === 0} data-testid="import-accept-exact">
              Accept all exact ({exactCount})
            </button>
          )}
          <span role="status" aria-live="polite" className="small" data-testid="import-bulk-status">
            {bulk}
          </span>
        </div>
      </section>

      <div className="import-panes">
        <section className="import-fields stack" aria-labelledby="import-fields-h" data-testid="import-fields">
          <h2 id="import-fields-h">Fields</h2>
          {groups.map((g) => {
            const all = g.subs.flatMap((s) => s.fields);
            if (g.name === "Document" || g.name === "Product and site") {
              return (
                <div key={g.name} className="stack import-group" data-testid="import-group">
                  <h3>{g.name}</h3>
                  <SimpleTable ctx={ctx} fields={all} />
                </div>
              );
            }
            if (!g.subs.every((s) => isParamGroup(s.fields) || s.fields.length === 0)) {
              return (
                <div key={g.name} className="stack import-group" data-testid="import-group">
                  <h3>{g.name}</h3>
                  <SimpleTable ctx={ctx} fields={all} />
                </div>
              );
            }
            const filled = g.subs.filter((s) => s.fields.some((f) => f.value || f.change || f.lockedBy));
            const empty = g.subs.filter((s) => !filled.includes(s));
            if (filled.length === 0) {
              return (
                <details key={g.name} className="import-group stack" data-testid="import-group">
                  <summary>
                    <strong>{g.name}</strong> (nothing filled in: stays open)
                  </summary>
                  <ParamTable ctx={ctx} subs={empty} />
                </details>
              );
            }
            const take = all.filter(bulkable).length;
            return (
              <section key={g.name} className="import-group stack" aria-label={g.name} data-testid="import-group">
                <div className="import-step-head">
                  <h3>{g.name}</h3>
                  {session.level !== 3 && (
                    <button type="button" className="btn small" disabled={take === 0} onClick={() => stepAccept(all)} data-testid="import-step-accept">
                      Accept all exact in this step ({take})
                    </button>
                  )}
                </div>
                <ParamTable ctx={ctx} subs={filled} />
                {empty.length > 0 && (
                  <details className="import-empty">
                    <summary>
                      Not filled ({empty.length} {empty.length === 1 ? "parameter" : "parameters"}): stays open
                    </summary>
                    <ParamTable ctx={ctx} subs={empty} />
                  </details>
                )}
              </section>
            );
          })}
        </section>

        <ImportDocPane
          blocks={session.blocks}
          cellFields={session.cellFields}
          anyChanged={(ids) => ids.some((id) => byId.get(id)?.change)}
          picking={picking ? [byId.get(picking)?.sub, byId.get(picking)?.label].filter(Boolean).join(", ") : null}
          onTake={takeText}
          onCancelPick={() => setPicking(null)}
          open={docOpen}
          setOpen={setDocOpen}
          innerRef={docPane}
        />
      </div>

      <section className="card stack" aria-labelledby="import-make-h" data-testid="import-make">
        <h2 id="import-make-h">Make the TRD</h2>
        {trds.length > 0 && (
          <fieldset className="stack">
            <legend>This project already has {trds.length === 1 ? "a TRD" : "TRDs"}. What should this upload do?</legend>
            <label className="check">
              <input type="radio" name="import-target" checked={target === "new"} onChange={() => setTarget("new")} data-testid="import-target-new" />
              <span>Make a new TRD</span>
            </label>
            {trds.map((d) => (
              <label key={d.id} className="check">
                <input type="radio" name="import-target" checked={target === d.id} onChange={() => setTarget(d.id)} data-testid={`import-target-${d.id}`} />
                <span>
                  Update {d.id}: {d.title}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {updating && <p className="muted small">Only the values you accept are changed. Values you set yourself in {updating.id} are protected: they are replaced only if you accept the file's value for them, one by one.</p>}
        {target === "new" && (
          <label className="field">
            <span>Title of the new TRD</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="import-title" />
            <span className="muted small">Leave empty to use the title from the file, if you accepted it.</span>
          </label>
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
            {updating ? `Update ${updating.id}` : "Make the TRD"}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              holdImport(null);
              navigate("/trd");
            }}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
