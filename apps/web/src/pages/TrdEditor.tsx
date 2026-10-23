import { deleteTrd, trdOpenItems, trdOverrides, updateTrd, type TrdOpenItem } from "@gap/engine";
import type { TrdDocument } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Modal } from "../components";
import { dateTime } from "../lib";
import { href, navigate } from "../router";
import { useStore } from "../store";
import type { Run } from "./SamplingFlow";
import { FieldRow } from "./TrdFieldRow";
import { TrdOutput } from "./TrdOutput";
import { TrdSteps } from "./TrdSteps";
import { TrdUpdate } from "./TrdUpdate";

export type TrdTab = "details" | "process" | "open" | "output";
const TAB_LABEL: Record<TrdTab, string> = { details: "1. Details", process: "2. Process", open: "3. Open items", output: "4. Output" };
export const TRD_TABS = Object.keys(TAB_LABEL) as TrdTab[];

/** What the page and the document both carry: what the tool does and what it leaves to people. */
export const TRD_SCOPE_TEXT =
  "The TRD is your document. Values come from the project or a seed file, and you can override any of them; the project value stays beside yours. The set point, NOR and PAR are entered by you with their sources. The tool checks them and reports; it does not decide a filing category.";

const KIND_TEXT: Record<TrdOpenItem["kind"], string> = {
  not_established: "Not established",
  tbd: "TBD",
  provisional: "TBD best guess, provisional",
  limit_problem: "Check",
  limit_open: "Open item",
  limit_note: "Note",
};

export function TrdEditor({ d, initialTab }: { d: TrdDocument; initialTab: TrdTab }) {
  const update = useStore((s) => s.update);
  const [tab, setTab] = useState<TrdTab>(initialTab);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const run: Run = (fn, status) => {
    const err = update(fn, status);
    setError(err ?? "");
    return !err;
  };
  const open = useMemo(() => trdOpenItems(d), [d]);

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>
          {d.id}: {d.title}
        </h1>
      </PageBanner>
      <p className="no-print">
        <a href={href("/trd")}>All TRDs</a>
      </p>
      <p className="muted" data-testid="trd-scope-text">
        {TRD_SCOPE_TEXT}
      </p>
      {error && (
        <p className="notice" role="alert" data-testid="trd-error">
          {error}
        </p>
      )}

      <TrdUpdate d={d} run={run} />

      <div role="group" aria-label="TRD steps" className="row wrap seg no-print" data-testid="trd-tabs">
        {TRD_TABS.map((t) => (
          <button key={t} type="button" className={tab === t ? "btn primary" : "btn"} aria-pressed={tab === t} onClick={() => setTab(t)} data-testid={`trd-tab-${t}`}>
            {TAB_LABEL[t]}
            {t === "open" ? ` (${open.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "details" && <Details d={d} run={run} />}
      {tab === "process" && <TrdSteps d={d} run={run} />}
      {tab === "open" && <OpenItems d={d} open={open} />}
      {tab === "output" && <TrdOutput d={d} run={run} />}

      <section className="card stack no-print" aria-labelledby="trd-delete">
        <h2 id="trd-delete">Delete this TRD</h2>
        <p className="muted small">The TRD leaves the project. The change log keeps what it said.</p>
        <div>
          <button
            type="button"
            className="btn danger"
            data-testid="trd-delete"
            onClick={(e) => {
              opener.current = e.currentTarget;
              setConfirmDelete(true);
            }}
          >
            Delete TRD
          </button>
        </div>
      </section>

      {confirmDelete && (
        <Modal open onOpenChange={(o) => !o && setConfirmDelete(false)} title="Delete this TRD?" description={`${d.id}: ${d.title} has ${d.steps.length} steps.`} restoreFocus={() => opener.current}>
          <div className="row end">
            <button type="button" className="btn" autoFocus onClick={() => setConfirmDelete(false)}>
              Keep the TRD
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="trd-delete-confirm"
              onClick={() => {
                setConfirmDelete(false);
                if (run((p, actor) => deleteTrd(p, d.id, actor), "TRD deleted")) navigate("/trd");
              }}
            >
              Delete TRD
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ step 1: details

function Details({ d, run }: { d: TrdDocument; run: Run }) {
  const [title, setTitle] = useState(d.title);
  const [docRef, setDocRef] = useState(d.docRef ?? "");
  const [version, setVersion] = useState(d.version ?? "");
  const [purpose, setPurpose] = useState(d.purpose ?? "");
  const [scope, setScope] = useState(d.scopeNote ?? "");
  const [mode, setMode] = useState<"first" | "edit" | undefined>(d.purpose?.trim() ? undefined : "first");
  const editBtn = useRef<HTMLButtonElement>(null);
  const focusEdit = useRef(false);
  const editing = mode !== undefined;
  useEffect(() => {
    if (!editing && focusEdit.current) {
      editBtn.current?.focus();
      focusEdit.current = false;
    }
  }, [editing]);
  const dirty = title !== d.title || docRef !== (d.docRef ?? "") || version !== (d.version ?? "") || purpose !== (d.purpose ?? "") || scope !== (d.scopeNote ?? "");

  return (
    <>
      <section className="card stack" aria-labelledby="trd-details-h">
        <h2 id="trd-details-h">Document details</h2>
        {!editing ? (
          <div className="batch-summary" role="group" aria-label="Document details summary" data-testid="trd-details-summary">
            <dl>
              <div>
                <dt>Title:</dt>
                <dd>
                  <strong>{d.title}</strong>
                </dd>
              </div>
              <div>
                <dt>Document reference:</dt>
                <dd>{d.docRef?.trim() || "not given"}</dd>
              </div>
              <div>
                <dt>Version:</dt>
                <dd>{d.version?.trim() || "not given"}</dd>
              </div>
              <div>
                <dt>Purpose:</dt>
                <dd>{d.purpose?.trim() || "not written yet"}</dd>
              </div>
              <div>
                <dt>Started from:</dt>
                <dd>
                  {d.origin.kind === "project" ? "this project" : d.origin.kind === "seed-import" ? `a TRD seed file${d.origin.seed ? ` (${d.origin.seed.projectName})` : ""}` : "a blank TRD"}, {dateTime(d.origin.importedAt)}
                </dd>
              </div>
            </dl>
            <div className="batch-actions">
              <button
                ref={editBtn}
                type="button"
                className="btn"
                aria-label="Edit document details"
                data-testid="trd-details-edit"
                onClick={() => {
                  setMode("edit");
                }}
              >
                Edit
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="trd-title" />
            </label>
            <div className="row wrap">
              <label className="field">
                <span>Document reference (optional)</span>
                <input value={docRef} onChange={(e) => setDocRef(e.target.value)} data-testid="trd-docref" />
              </label>
              <label className="field">
                <span>Version (optional)</span>
                <input value={version} onChange={(e) => setVersion(e.target.value)} data-testid="trd-version" />
              </label>
            </div>
            <label className="field">
              <span>Purpose</span>
              <textarea rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} data-testid="trd-purpose" />
              <span className="muted small">Why this document exists. Written by your team; the tool does not suggest it.</span>
            </label>
            <label className="field">
              <span>Scope note (optional)</span>
              <textarea rows={2} value={scope} onChange={(e) => setScope(e.target.value)} />
            </label>
            <div className="row wrap">
              <button
                type="button"
                className="btn primary"
                data-testid="trd-details-save"
                disabled={!dirty || !title.trim()}
                onClick={() => {
                  if (run((p, actor) => updateTrd(p, d.id, { title, docRef, version, purpose, scopeNote: scope }, actor), "TRD details saved")) {
                    focusEdit.current = true;
                    setMode(undefined);
                  }
                }}
              >
                Save details
              </button>
              {mode === "edit" && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setTitle(d.title);
                    setDocRef(d.docRef ?? "");
                    setVersion(d.version ?? "");
                    setPurpose(d.purpose ?? "");
                    setScope(d.scopeNote ?? "");
                    focusEdit.current = true;
                    setMode(undefined);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="card stack" aria-labelledby="trd-product-h">
        <h2 id="trd-product-h">Product and site</h2>
        <p className="muted small">These come from the project. Override one when the TRD should say something else; the project value stays beside it.</p>
        <ul className="plain-list trd-fields" aria-label="Product and site values">
          {d.details.map((f) => (
            <FieldRow key={f.key} docId={d.id} f={f} addr={{ part: "details", field: f.key }} run={run} testId={`trd-field-details-${f.key}`} />
          ))}
        </ul>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ step 3: open items

function OpenItems({ d, open }: { d: TrdDocument; open: TrdOpenItem[] }) {
  const overrides = trdOverrides(d);
  return (
    <>
      <section className="card stack" aria-labelledby="trd-open-h" data-testid="trd-open-items">
        <h2 id="trd-open-h">Open items ({open.length})</h2>
        {open.length === 0 ? (
          <p>No open items. This says the entries are all there, not that the numbers are right; that decision belongs to your team and your quality system.</p>
        ) : (
          <ul className="plain-list small">
            {open.map((o, i) => (
              <li key={i}>
                <strong>{KIND_TEXT[o.kind]}:</strong> {o.where}. {o.kind === "not_established" || o.kind === "tbd" ? "" : `${o.text}.`}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card stack" aria-labelledby="trd-ovr-h" data-testid="trd-overrides">
        <h2 id="trd-ovr-h">Overrides ({overrides.length})</h2>
        {overrides.length === 0 ? (
          <p>No value has been overridden.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="Overrides table" tabIndex={0}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Where</th>
                  <th scope="col">Project value</th>
                  <th scope="col">TRD value</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Entered by</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o, i) => (
                  <tr key={i}>
                    <th scope="row">
                      {o.where}, {o.field}
                    </th>
                    <td>{o.overridesProject ? o.projectValue : "No project value"}</td>
                    <td>{o.trdValue}</td>
                    <td>{o.reason}</td>
                    <td className="small">
                      {o.by}, {dateTime(o.at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
