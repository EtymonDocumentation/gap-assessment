import { NO_VALUE_YET, deleteTrd, deriveTrdQuestions, trdOpenItems, trdOverrides, updateTrd, type TrdOpenItem } from "@gap/engine";
import { trdInterviewWording } from "@gap/content";
import type { TrdDocument } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../components";
import { focusWhenReady, PageHeader, type PagePill } from "../PageHeader";
import { Tabs, type TabDef } from "../Tabs";
import { landAtTop } from "../land-at-top";
import { countOf, dateTime } from "../lib";
import { href, navigate } from "../router";
import { StageRow } from "../stage-ui";
import { useContent, useStore } from "../store";
import { openItemsCount, trdOpenCount, type OpenCount } from "../open-count";
import { openItemQuestionKey, placeInterviewTab, trdIsEmpty } from "../trd-interview-lib";
import type { Run } from "./SamplingFlow";
import { FieldRow } from "./TrdFieldRow";
import { TrdInterview, type InterviewShow } from "./TrdInterview";
import { TrdOutput } from "./TrdOutput";
import { TrdSteps } from "./TrdSteps";
import { TrdUpdate, useProjectDifferences } from "./TrdUpdate";
import { TrdWriteups } from "./TrdWriteups";

export type TrdTab = "interview" | "details" | "process" | "writeups" | "open" | "output";
const TAB_LABEL: Record<TrdTab, string> = { interview: "Interview", details: "1. Details", process: "2. Process", writeups: "3. Descriptions", open: "4. Open items", output: "5. Document" };
export const TRD_TABS = Object.keys(TAB_LABEL) as TrdTab[];
/** The five existing steps become tabs unchanged (same order and test ids); each gets a one-line purpose and a longer "?" help. */
const TAB_INFO: Omit<TabDef<TrdTab>, "label">[] = [
  {
    id: "interview",
    testId: "trd-tab-interview",
    tour: "trd-interview",
    purpose: "Answer plain questions and the TRD fills itself in. Anything you don't know stays open.",
    help: "The same TRD as the other tabs. Answer from a list, or switch on Show one question at a time. Every answer is written into the TRD, so the form, the descriptions, the open items and the document show it at once. Don't know yet leaves the question open. Not applicable here is an answer. Mark as to be decided (TBD) records that the value is still to be decided. A value from the gap assessment shows beside its question: choose Keep this or Change it. The Show filter lists everything, only what is still open, or only what came from the project. You can also print the blank form.",
  },
  {
    id: "details",
    testId: "trd-tab-details",
    purpose: "Name the TRD and say what it is for and what it covers.",
    help: "The title, reference, version, purpose and scope of this TRD. Fill it first so everyone reading the document knows what it is about.",
  },
  {
    id: "process",
    testId: "trd-tab-process",
    purpose: "The process steps and their parameters, with the project value beside yours. You enter the set point, the NOR (normal operating range) and the PAR (proven acceptable range).",
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
    help: "A to-do list built from the TRD: values that are still TBD, provisional values and limits that failed a check. The count in the tab name goes down as you fill them in.",
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
  not_established: NO_VALUE_YET,
  tbd: "TBD",
  provisional: "TBD best guess, provisional",
  limit_problem: "Check",
  limit_open: "Open item",
  limit_note: "Note",
};

export function TrdEditor({ d, initialTab, initialShow, initialQuestion }: { d: TrdDocument; initialTab: TrdTab; initialShow?: InterviewShow; initialQuestion?: string }) {
  const update = useStore((s) => s.update);
  const [tab, setTab] = useState<TrdTab>(initialTab);
  // A link to another tab of the TRD that is already open (same page, new address) switches the tab.
  useEffect(() => setTab(initialTab), [initialTab]);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  // A TRD opens at its top, under the header and the tabs. Making one, or opening one from the list, changes only the query of the address
  // (the path stays /trd), so the scroll-to-top that runs for a new page did not run: the person landed wherever the list had been scrolled
  // to, far down the new page, and the header with the Menu was out of sight.
  useEffect(() => {
    // An address that names a question goes to that question (the interview scrolls to it and puts the cursor there), not to the top. That is why
    // this calls landAtTop() itself instead of useLandAtTop(d.id), which would always scroll back to the top after the interview had jumped.
    if (!initialQuestion) landAtTop();
  }, [d.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The question an Open items entry points to. Used once: choosing a tab by hand drops it, so the Interview tab does not jump back to it later.
  const [jump, setJump] = useState<string | undefined>(initialQuestion);
  const run: Run = (fn, status) => {
    const err = update(fn, status);
    setError(err ?? "");
    return !err;
  };
  const open = useMemo(() => trdOpenItems(d), [d]);
  // The one count (open-count.ts): the entries of the list plus the blank fields in the descriptions. The tab, the pill and the Open items tab say the same number.
  const projectForCount = useStore((s) => s.project)!;
  const count = useMemo(() => trdOpenCount(projectForCount, d), [projectForCount, d]);
  // Keep the address in step with the tab so a reload or a copied link opens the same tab. replaceState fires no hashchange, so the
  // page is not re-rendered or reset by it.
  const select = (t: TrdTab) => {
    setTab(t);
    setJump(undefined);
    window.history.replaceState(null, "", href("/trd", { trd: d.id, tab: t }));
  };
  // An entry of the Open items tab: the Interview tab, scrolled to the question that asks for the missing value.
  const goToQuestion = (key: string) => {
    setTab("interview");
    setJump(key);
    window.history.replaceState(null, "", href("/trd", { trd: d.id, tab: "interview" }));
  };
  // The Interview tab is first for a TRD with nothing in it and otherwise right after "1. Details". Decided once when the page opens, so the tabs do
  // not move under the person while they answer.
  const [emptyAtOpen] = useState(() => trdIsEmpty(d));
  const order = placeInterviewTab(TAB_INFO.filter((t) => t.id !== "interview").map((t) => t.id), "interview" as TrdTab, emptyAtOpen);
  const tabDefs = order.map((id) => TAB_INFO.find((t) => t.id === id)!).map((t) => ({ ...t, label: `${TAB_LABEL[t.id]}${t.id === "open" ? ` (${count.total})` : ""}` }));

  // Facts the page already knows. "Differences from the project" is the same count the review in the Details tab lists.
  const differences = useProjectDifferences(d);
  const pills: PagePill[] = [
    { label: `${d.steps.length} process ${d.steps.length === 1 ? "step" : "steps"}`, testId: "trd-pill-steps" },
    { label: openItemsCount(count.total), warning: count.total > 0, testId: "trd-pill-open" },
    ...(differences === null
      ? []
      : [differences > 0 ? { label: `${differences} ${differences === 1 ? "difference" : "differences"} from the project`, warning: true, testId: "trd-pill-update" } : { label: "Up to date with the project", testId: "trd-pill-update" }]),
  ];
  // The update itself lives in the Details tab; this button takes the person there and puts the cursor on its first control.
  const toUpdate = (testId: string) => () => {
    select("details");
    focusWhenReady(testId);
  };
  const updateAction =
    d.origin.kind === "project" && differences ? (
      <button type="button" className="btn" onClick={toUpdate("trd-review-toggle")} data-testid="trd-update-action">
        Update from the project
      </button>
    ) : d.origin.kind === "seed-import" ? (
      <button type="button" className="btn" onClick={toUpdate("trd-update-file")} data-testid="trd-update-action">
        Update from a newer seed file
      </button>
    ) : undefined;
  // The downloads are made in the Document tab, where the kind of Word document and the pre-download checks are shown; the menu takes the
  // person there with the matching button focused.
  const toOutput = (testId: string) => () => {
    select("output");
    focusWhenReady(testId);
  };

  return (
    <div className="stack-lg">
      <PageHeader
        title={`${d.id}: ${d.title}`}
        crumb={d.id}
        purpose="The written statement of the process: its steps, parameters and ranges, each with a source."
        pills={pills}
        meta={`${d.version ? `Version ${d.version} · ` : ""}Last changed ${dateTime(d.updatedAt)}`}
        about={{
          art: "page-document",
          children: (
            <>
              <p>
                The TRD (technical requirements document) is the written statement of the process: its steps, parameters, set points, normal operating ranges (NOR) and proven acceptable ranges (PAR), each with a source. It starts from the project, a seed file or blank.
              </p>
              <p>Next in the chain: the sampling plan, then the batch record, which can take its parameter values from this TRD.</p>
              <p data-testid="trd-scope-text">{TRD_SCOPE_TEXT}</p>
            </>
          ),
        }}
        actions={updateAction}
        exports={[
          { label: "Download TRD (Word)", onSelect: toOutput("trd-download-word") },
          { label: "Download TRD (HTML)", onSelect: toOutput("trd-download-html") },
          { label: "Download evidence record (Word)", onSelect: toOutput("trd-evidence-download-word") },
          { label: "Download evidence record (HTML)", onSelect: toOutput("trd-evidence-download-html") },
        ]}
      />
      {error && (
        <p className="notice" role="alert" data-testid="trd-error">
          {error}
        </p>
      )}

      <Tabs label="TRD steps" tabs={tabDefs} selected={tab} onSelect={select} testId="trd-tabs" tour="trd-tabs">
        {tab === "interview" && <TrdInterview d={d} {...(initialShow ? { initialShow } : {})} {...(jump ? { initialQuestion: jump } : {})} />}
        {tab === "details" && <Details d={d} run={run} />}
        {/* The update (a newer seed file, or the differences from the project) sits under the details. It stays mounted while another tab is
            open, so a file already read and a review in progress are not lost by a look at the Process tab; the page shows it only here. */}
        <div hidden={tab !== "details"}>
          <TrdUpdate d={d} run={run} />
        </div>
        {tab === "process" && <TrdSteps d={d} run={run} />}
        {tab === "writeups" && <TrdWriteups d={d} run={run} />}
        {tab === "open" && <OpenItems d={d} open={open} count={count} onQuestion={goToQuestion} onTab={select} />}
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
        <Modal open onOpenChange={(o) => !o && setConfirmDelete(false)} title="Delete this TRD?" description={`${d.id}: ${d.title} has ${countOf(d.steps.length, "step")}.`} restoreFocus={() => opener.current}>
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
        {/* Say where the values come from only when that is true: a blank TRD has none until someone types them. */}
        <p className="muted small" data-testid="trd-product-note">
          {d.origin.kind === "project"
            ? "These come from the project. Override one when the TRD should say something else; the project value stays beside it."
            : d.origin.kind === "seed-import"
              ? "These come from the TRD seed file. Override one when the TRD should say something else; the file's value stays beside it."
              : "Type the values here. Each one is yours; nothing is filled in for you."}
        </p>
        <p className="trd-project-stage" data-testid="trd-project-stage">
          <strong>Project stage:</strong> <StageRow />
          <span className="small muted"> One value for the whole project; the TRD, sampling plan and batch record follow it. Changing it asks why and saves a new version.</span>
        </p>
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

function OpenItems({ d, open, count, onQuestion, onTab }: { d: TrdDocument; open: TrdOpenItem[]; count: OpenCount; onQuestion: (key: string) => void; onTab: (t: TrdTab) => void }) {
  // An override is a value typed in place of one the project has. A value typed where the project had nothing (a TRD without a gap
  // assessment, or a detail the project does not know) is the person's own answer; listing it here as an override with "No project value" and
  // "No reason recorded" made a first-time user think something had gone wrong.
  const overrides = trdOverrides(d).filter((o) => o.overridesProject);
  const project = useStore((s) => s.project)!;
  const content = useContent();
  // Each entry is a link to the question that asks for it. An entry the interview has no question for (a field of a step itself) opens the tab that holds it.
  const questionKeys = useMemo(() => new Set(deriveTrdQuestions(project, d.id, { content, wording: trdInterviewWording }).map((q) => q.key)), [project, d.id, content]);
  // One count, broken down (open-count.ts): everything still to fill is the entries listed here plus the blank fields in the text of the process
  // descriptions (same wording as the exported document). The parts are named so nobody has to add them up to see where the number comes from.
  const blanks = count.blanks;
  return (
    <>
      <section className="card stack" aria-labelledby="trd-open-h" data-testid="trd-open-items">
        <h2 id="trd-open-h">{openItemsCount(count.total)}</h2>
        {blanks > 0 && (
          <p className="notice" data-testid="trd-blank-count">
            {openItemsCount(count.total)}: {count.entries} {count.entries === 1 ? "entry" : "entries"} listed below, and {blanks} blank {blanks === 1 ? "field" : "fields"} in the text of the process descriptions.{" "}
            <a
              href={href("/trd", { trd: d.id, tab: "writeups" })}
              onClick={(e) => {
                e.preventDefault();
                onTab("writeups");
              }}
            >
              See the blank fields on the Descriptions tab
            </a>
            .
          </p>
        )}
        {open.length === 0 ? (
          <p>{blanks > 0 ? "No entries are open." : "No open items."} This says the entries are all there, not that the numbers are right; that decision belongs to your team and your quality system.</p>
        ) : (
          <>
            <p className="muted small">Select an entry to go to its question.</p>
            <ul className="plain-list small">
              {open.map((o, i) => {
                const q = openItemQuestionKey(d, o, questionKeys);
                const tab: TrdTab = o.stepId || o.itemRef ? "process" : "details";
                return (
                  <li key={i}>
                    <strong>{KIND_TEXT[o.kind]}:</strong>{" "}
                    <a
                      href={q ? href("/trd", { trd: d.id, tab: "interview", q }) : href("/trd", { trd: d.id, tab })}
                      data-testid="trd-open-link"
                      onClick={(e) => {
                        e.preventDefault();
                        if (q) onQuestion(q);
                        else onTab(tab);
                      }}
                    >
                      {o.where}
                    </a>
                    . {o.kind === "not_established" || o.kind === "tbd" ? "" : `${o.text}.`}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      <section className="card stack" aria-labelledby="trd-ovr-h" data-testid="trd-overrides">
        <h2 id="trd-ovr-h">Overrides ({overrides.length})</h2>
        {overrides.length === 0 ? (
          <p>No value has been overridden. A value you type where the project has none is your own answer, not an override.</p>
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
                    <td>{o.projectValue}</td>
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
