import type { CompanyTableSnapshot } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Empty, Modal } from "../components";
import { dateTime, download, slug } from "../lib";
import { href } from "../router";
import { newTableId, parseTableFile, tableFileJson, tableProblems, useSamplingTables, type StoredTable } from "../sampling-tables-store";
import { SERVER_MODE } from "../server/mode";

interface RowText {
  lotMin: string;
  lotMax: string;
  sampleSize: string;
  accept: string;
  reject: string;
  testKey: string;
}
interface FormState {
  id: string;
  isNew: boolean;
  name: string;
  version: string;
  documentRef: string;
  owner: string;
  note: string;
  rows: RowText[];
}

const blankRow = (): RowText => ({ lotMin: "", lotMax: "", sampleSize: "", accept: "", reject: "", testKey: "" });
const toForm = (t: CompanyTableSnapshot, isNew = false): FormState => ({
  id: t.id,
  isNew,
  name: t.name,
  version: t.version,
  documentRef: t.documentRef ?? "",
  owner: t.owner ?? "",
  note: t.note ?? "",
  rows: t.rows.map((r) => ({ lotMin: String(r.lotMin), lotMax: r.lotMax === null ? "" : String(r.lotMax), sampleSize: String(r.sampleSize), accept: r.accept === undefined ? "" : String(r.accept), reject: r.reject === undefined ? "" : String(r.reject), testKey: r.testKey ?? "" })),
});

const WHOLE = /^\d+$/;

/**
 * Turns the form into a table. Text that is not a whole number is reported in words (and the row is kept out of the table that
 * is checked), so a typo is never silently turned into a 0.
 */
function toTable(f: FormState): { table: CompanyTableSnapshot; typos: string[] } {
  const typos: string[] = [];
  const rows: CompanyTableSnapshot["rows"] = [];
  f.rows.forEach((r, i) => {
    const n = i + 1;
    const bad = (label: string, v: string, optional: boolean) => {
      if (v.trim() === "" ? !optional : !WHOLE.test(v.trim())) typos.push(`Row ${n}: ${label} must be a whole number${optional ? " or empty" : ""}.`);
      return v.trim() === "" || !WHOLE.test(v.trim());
    };
    const badMin = bad("Lot size from", r.lotMin, false);
    const badMax = bad("Lot size to", r.lotMax, true);
    const badN = bad("Sample size", r.sampleSize, false);
    const badA = bad("Accept", r.accept, true);
    const badR = bad("Reject", r.reject, true);
    if (badMin || badN || (badMax && r.lotMax.trim() !== "") || (badA && r.accept.trim() !== "") || (badR && r.reject.trim() !== "")) return;
    rows.push({
      lotMin: Number(r.lotMin),
      lotMax: r.lotMax.trim() === "" ? null : Number(r.lotMax),
      sampleSize: Number(r.sampleSize),
      ...(r.accept.trim() !== "" ? { accept: Number(r.accept) } : {}),
      ...(r.reject.trim() !== "" ? { reject: Number(r.reject) } : {}),
      ...(r.testKey.trim() ? { testKey: r.testKey.trim() } : {}),
    });
  });
  return {
    typos,
    table: { id: f.id, name: f.name.trim(), version: f.version.trim(), ...(f.documentRef.trim() ? { documentRef: f.documentRef.trim() } : {}), ...(f.owner.trim() ? { owner: f.owner.trim() } : {}), rows, ...(f.note.trim() ? { note: f.note.trim() } : {}) },
  };
}

/**
 * The company sampling tables library. A table is the company's own rule "lot size from-to gives this sample size". The tool
 * never ships a table of its own: it reads the rows you enter. A table with problems can be saved (so work is not lost) but
 * cannot be chosen for a point until the problems are gone.
 */
export function SamplingTablesPage() {
  const items = useSamplingTables((s) => s.items);
  const ready = useSamplingTables((s) => s.ready);
  const storeError = useSamplingTables((s) => s.error);
  const load = useSamplingTables((s) => s.load);
  const save = useSamplingTables((s) => s.save);
  const remove = useSamplingTables((s) => s.remove);
  useEffect(() => void load(), [load]);
  const [form, setForm] = useState<FormState | null>(null);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<StoredTable | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const built = useMemo(() => (form ? toTable(form) : null), [form]);
  const problems = useMemo(() => {
    if (!built || !form) return [];
    const p = [...built.typos];
    if (!form.name.trim()) p.unshift("Give the table a name.");
    if (!form.version.trim()) p.unshift("Give the table a version (the version of your document).");
    if (built.typos.length === 0 && form.name.trim()) p.push(...tableProblems(built.table));
    return [...new Set(p)];
  }, [built, form]);

  async function doSave() {
    if (!form || !built) return;
    // The version and name are always needed to store a table; other problems are kept visible after saving.
    if (!form.name.trim() || !form.version.trim() || built.typos.length > 0) return setMessage("Fix the entries listed below before saving.");
    try {
      const saved = await save(built.table, form.isNew ? "created" : "edited");
      setForm(toForm(saved));
      setMessage(`Saved ${saved.name}, version ${saved.version}.`);
    } catch {
      setMessage("");
    }
  }

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setRow = (i: number, patch: Partial<RowText>) => setForm((f) => (f ? { ...f, rows: f.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : f));

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>Sampling tables</h1>
      </PageBanner>
      <section className="card stack" aria-labelledby="st-about">
        <h2 id="st-about">What this is</h2>
        <p>
          Your quality system may set the sample size by lot size in its own table. Enter it here once, and choose it for a sampling point on the <a href={href("/sampling")}>Sampling plan</a> page. The tool reads the row that holds the batch's lot size.
        </p>
        <ul className="plain-list">
          <li>{SERVER_MODE ? "Tables are kept on the server for your account." : "Tables are kept in this browser, not in the project file. Export a table to keep a copy as a file."}</li>
          <li>A point keeps a copy of the table it used, so changing a table later does not silently change a plan that was already issued.</li>
          <li>Row ranges must not overlap and must not leave gaps. A lot size outside every row has no sample size: the plan shows an open item.</li>
        </ul>
      </section>

      {storeError && (
        <p className="notice" role="alert" data-testid="tables-error">
          {storeError}
        </p>
      )}

      <section className="card stack" aria-labelledby="st-list">
        <div className="row between wrap">
          <h2 id="st-list">Your tables ({items.length})</h2>
          <div className="row wrap">
            <button type="button" className="btn primary" data-testid="table-new" onClick={() => setForm(toForm({ id: newTableId(), name: "", version: "", rows: [] }, true))}>
              New table
            </button>
            <button type="button" className="btn" onClick={() => fileInput.current?.click()} data-testid="table-import">
              Import from file
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="visually-hidden"
              tabIndex={-1}
              aria-label="Choose a sampling table file"
              data-testid="table-import-input"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const t = parseTableFile(await file.text());
                  const saved = await save(t, "imported");
                  setForm(toForm(saved));
                  setMessage(`Imported ${saved.name}, version ${saved.version}.`);
                } catch (err) {
                  setMessage((err as Error).message);
                }
              }}
            />
          </div>
        </div>
        <div role="status" aria-live="polite">
          {message && <p data-testid="tables-message">{message}</p>}
        </div>
        {!ready ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <Empty>No table yet. Create one, or import a table file.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Sampling tables list" tabIndex={0}>
            <table className="data" data-testid="tables-list">
              <thead>
                <tr>
                  <th scope="col">Table</th>
                  <th scope="col">Version</th>
                  <th scope="col">Rows</th>
                  <th scope="col">Can be chosen</th>
                  <th scope="col">Last changed</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => {
                  const p = tableProblems(t);
                  return (
                    <tr key={t.id}>
                      <th scope="row">{t.name}</th>
                      <td>{t.version}</td>
                      <td className="num">{t.rows.length}</td>
                      <td>{p.length === 0 ? "Yes" : `No: ${p.length} ${p.length === 1 ? "problem" : "problems"}`}</td>
                      <td className="small">{dateTime(t.updatedAt)}</td>
                      <td>
                        <div className="row wrap">
                          <button type="button" className="btn small" aria-label={`Edit ${t.name}`} onClick={() => setForm(toForm(t))}>
                            Edit
                          </button>
                          <button type="button" className="btn small" aria-label={`Export ${t.name} as a file`} onClick={() => download(`${slug(t.name)}.gap-sampling-table.json`, `${tableFileJson(t)}\n`, "application/json;charset=utf-8")}>
                            Export
                          </button>
                          <button
                            type="button"
                            className="btn small danger"
                            aria-label={`Delete ${t.name}`}
                            onClick={(e) => {
                              opener.current = e.currentTarget;
                              setConfirm(t);
                            }}
                          >
                            Delete
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
      </section>

      {form && (
        <section className="card stack" aria-labelledby="st-edit" data-testid="table-editor">
          <h2 id="st-edit">{form.isNew ? "New table" : `Edit ${form.name || "table"}`}</h2>
          <div className="row wrap">
            <label className="field">
              <span>Table name</span>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} data-testid="table-name" />
            </label>
            <label className="field">
              <span>Version</span>
              <input value={form.version} onChange={(e) => set({ version: e.target.value })} data-testid="table-version" />
            </label>
            <label className="field">
              <span>
                Document reference <span className="muted">(optional)</span>
              </span>
              <input value={form.documentRef} onChange={(e) => set({ documentRef: e.target.value })} />
            </label>
            <label className="field">
              <span>
                Owner <span className="muted">(optional)</span>
              </span>
              <input value={form.owner} onChange={(e) => set({ owner: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>
              Note <span className="muted">(optional)</span>
            </span>
            <input value={form.note} onChange={(e) => set({ note: e.target.value })} />
          </label>

          <div className="table-scroll" role="region" aria-label="Table rows" tabIndex={0}>
            <table className="data table-rows">
              <caption className="visually-hidden">Rows of the sampling table. Leave "Lot size to" empty for a row that has no upper limit.</caption>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Lot size from</th>
                  <th scope="col">Lot size to</th>
                  <th scope="col">Sample size</th>
                  <th scope="col">Accept</th>
                  <th scope="col">Reject</th>
                  <th scope="col">Test key</th>
                  <th scope="col">Remove</th>
                </tr>
              </thead>
              <tbody>
                {form.rows.map((r, i) => (
                  <tr key={i}>
                    <th scope="row">{i + 1}</th>
                    {(["lotMin", "lotMax", "sampleSize", "accept", "reject", "testKey"] as const).map((k) => (
                      <td key={k}>
                        <input
                          className="cell-input"
                          value={r[k]}
                          inputMode={k === "testKey" ? "text" : "numeric"}
                          aria-label={`Row ${i + 1} ${{ lotMin: "lot size from", lotMax: "lot size to", sampleSize: "sample size", accept: "accept", reject: "reject", testKey: "test key" }[k]}`}
                          data-testid={`row-${i}-${k}`}
                          onChange={(e) => setRow(i, { [k]: e.target.value })}
                        />
                      </td>
                    ))}
                    <td>
                      <button type="button" className="btn small" aria-label={`Remove row ${i + 1}`} onClick={() => set({ rows: form.rows.filter((_, j) => j !== i) })}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <button type="button" className="btn" data-testid="table-add-row" onClick={() => set({ rows: [...form.rows, blankRow()] })}>
              Add row
            </button>
          </div>

          <div aria-live="polite" data-testid="table-problems">
            {problems.length === 0 ? (
              <p>No problems found. This table can be chosen for a sampling point.</p>
            ) : (
              <>
                <p>
                  <strong>
                    {problems.length} {problems.length === 1 ? "problem" : "problems"} to fix before this table can be chosen for a point:
                  </strong>
                </p>
                <ul className="plain-list small">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="row wrap">
            <button type="button" className="btn primary" onClick={() => void doSave()} data-testid="table-save">
              Save table
            </button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              Close the editor
            </button>
          </div>

          {!form.isNew && <TableHistory table={items.find((t) => t.id === form.id)} />}
        </section>
      )}

      {confirm && (
        <Modal open onOpenChange={(o) => !o && setConfirm(null)} title="Delete this table?" description={`${confirm.name}, version ${confirm.version}. Plans that already use it keep their own copy.`} restoreFocus={() => opener.current}>
          <div className="row end">
            <button type="button" className="btn" autoFocus onClick={() => setConfirm(null)}>
              Keep the table
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="table-delete-confirm"
              onClick={() => {
                const id = confirm.id;
                setConfirm(null);
                if (form?.id === id) setForm(null);
                void remove(id).then(() => setMessage("Table deleted."), () => undefined);
              }}
            >
              Delete table
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TableHistory({ table }: { table: StoredTable | undefined }) {
  if (!table || table.history.length === 0) return null;
  return (
    <details data-testid="table-history">
      <summary>Edit history ({table.history.length})</summary>
      <ul className="plain-list small">
        {[...table.history].reverse().map((h, i) => (
          <li key={`${h.at}-${i}`}>
            {dateTime(h.at)}: {h.action === "created" ? "created" : h.action === "imported" ? "imported" : "edited"}
            {h.before ? `. Before the edit: version ${h.before.version}, ${h.before.rows.length} ${h.before.rows.length === 1 ? "row" : "rows"}.` : "."}
          </li>
        ))}
      </ul>
    </details>
  );
}
