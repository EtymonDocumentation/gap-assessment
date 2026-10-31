import { deleteTrd, trdOpenItems, trdOverrides, updateTrd, type TrdOpenItem } from "@gap/engine";
import type { TrdDocument } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Modal } from "../components";
import { Tabs, type TabDef } from "../Tabs";
import { WhatThisIs } from "../WhatThisIs";
import { dateTime } from "../lib";
import { href, navigate } from "../router";
import { useStore } from "../store";
import type { Run } from "./SamplingFlow";
import { FieldRow } from "./TrdFieldRow";
import { TrdOutput } from "./TrdOutput";
import { TrdSteps } from "./TrdSteps";
import { TrdUpdate } from "./TrdUpdate";
import { TrdWriteups } from "./TrdWriteups";

export type TrdTab = "details" | "process" | "writeups" | "open" | "output";
const TAB_LABEL: Record<TrdTab, string> = { details: "1. Details", process: "2. Process", writeups: "3. Descriptions", open: "4. Open items", output: "5. Output" };
export const TRD_TABS = Object.keys(TAB_LABEL) as TrdTab[];
/** The five existing steps become tabs unchanged (same order and test ids); each gets a one-line purpose and a longer "?" help. */
const TAB_INFO: Omit<TabDef<TrdTab>, "label">[] = [
  {
    id: "details",
    testId: "trd-tab-details",
    purpose: "Name the TRD and say what it is for and what it covers.",
    help: "The title, reference, version, purpose and scope of this TRD. Fill it first so everyone reading the document knows what it is about.",
  },
  {
    id: "process",
    testId: "trd-tab-process",
    purpose: "The process steps and their parameters, with the project value beside yours.",
    help: "Each step holds parameter rows. A value comes from the project or a seed file and can be overridden; the original stays beside yours. Set point, NOR and PAR are entered by you with a source.",
  },
  {
    id: "writeups",
    testId: "trd-tab-writeups",
    purpose: "Process descriptions for each step, chosen from the library or written here.",
    help: "Prose that describes what happens in each step. Pick a write-up from the process description library or write your own; the library entry stays unchanged.",
  },
  {
    id: "open",
    testId: "trd-tab-open",
    purpose: "Everything still missing, provisional or in need of a check.",
    help: "A to-do list built from the TRD: values not established, TBD entries and limits that failed a check. The count in the tab name goes down as you fill them in.",
  },
  {
    id: "output",
    testId: "trd-tab-output",
    purpose: "Preview and download the TRD as Word or HTML.",
    help: "Makes the draft document from what is entered. Open items stay visible in the draft. Each download is written to the export history.",
  },
];

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
  // A link to another tab of the TRD that is already open (same page, new address) switches the tab.
  useEffect(() => setTab(initialTab), [initialTab]);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const run: Run = (fn, status) => {
    const err = update(fn, status);
    setError(err ?? "");
    return !err;
  };
  const open = useMemo(() => trdOpenItems(d), [d]);
  // Keep the address in step with the tab so a reload or a copied link opens the same tab. replaceState fires no hashchange, so the
  // page is not re-rendered or reset by it.
  const select = (t: TrdTab) => {
    setTab(t);
    window.history.replaceState(null, "", href("/trd", { trd: d.id, tab: t }));
  };
  const tabDefs = TAB_INFO.map((t) => ({ ...t, label: `${TAB_LABEL[t.id]}${t.id === "open" ? ` (${open.length})` : ""}` }));

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
      <WhatThisIs id="trd">
        <p>
          The TRD (technical requirements document) is the written statement of the process: its steps, parameters, set points, normal and proven acceptable ranges, each with a source. It starts from the project, a seed file or blank.
        </p>
        <p>Next in the chain: the sampling plan, then the batch record, which can take its parameter values from this TRD. The tool checks your values and reports; it does not decide a filing category.</p>
      </WhatThisIs>
      <p className="muted" data-testid="trd-scope-text">
        {TRD_SCOPE_TEXT}
      </p>
      {error && (
        <p className="notice" role="alert" data-testid="trd-error">
          {error}
        </p>
      )}

      <TrdUpdate d={d} run={run} />

      <Tabs label="TRD steps" tabs={tabDefs} selected={tab} onSelect={select} testId="trd-tabs">
        {tab === "details" && <Details d={d} run={run} />}
        {tab === "process" && <TrdSteps d={d} run={run} />}
        {tab === "writeups" && <TrdWriteups d={d} run={run} />}
        {tab === "open" && <OpenItems d={d} open={open} />}
        {tab === "output" && <TrdOutput d={d} run={run} />}
      </Tabs>

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
