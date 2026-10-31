import { createAssessment, deleteAssessment, projectScopeSteps, riskOpenItems, updateAssessment } from "@gap/engine";
import type { RiskAssessment } from "@gap/process-model";
import { describeMethod } from "@gap/risk";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Empty, Modal } from "../components";
import { Tabs, type TabDef } from "../Tabs";
import { WhatThisIs } from "../WhatThisIs";
import { dateTime } from "../lib";
import { href, navigate } from "../router";
import { useContent, useStore } from "../store";
import { RiskActions } from "./RiskActions";
import { RiskItems } from "./RiskItems";
import { RiskMethod } from "./RiskMethod";
import { RiskReview } from "./RiskReview";
import { RiskOutput } from "./RiskOutput";
import type { Run } from "./SamplingFlow";

type Tab = "method" | "items" | "actions" | "output";
const TAB_LABEL: Record<Tab, string> = { method: "1. Method", items: "2. Items", actions: "3. Actions", output: "4. Output" };
const TABS = Object.keys(TAB_LABEL) as Tab[];
/** The four steps of the assessment, in the order the work goes: how to score, what to score, what to do about it, the document. */
const TAB_DEFS: TabDef<Tab>[] = [
  {
    id: "method",
    label: TAB_LABEL.method,
    testId: "risk-tab-method",
    purpose: "Choose how risks are scored: the method, its scales and its bands.",
    help: "Start here. The method decides how a score is worked out and what the bands are called. You choose it; the tool never picks a method or says a risk is acceptable. A starter is only a shape you then edit.",
  },
  {
    id: "items",
    label: TAB_LABEL.items,
    testId: "risk-tab-items",
    purpose: "List what could go wrong and score each item with your method.",
    help: "Each item is one failure mode with its effect and cause. Add items from gaps, from the catalog or free-form, then enter the scores. A missing score reads as \"not scored\", never as a guess.",
  },
  {
    id: "actions",
    label: TAB_LABEL.actions,
    testId: "risk-tab-actions",
    purpose: "Record the actions that follow from the items, with an owner and a due date.",
    help: "Use this once items are scored. An action says what will be done about an item, by whom and by when. Residual risk after the action is optional.",
  },
  {
    id: "output",
    label: TAB_LABEL.output,
    testId: "risk-tab-output",
    purpose: "Preview and download the risk assessment as Word or HTML.",
    help: "Makes the draft document from what is entered. Open items stay visible in the draft. Each download is written to the export history.",
  },
];

/** The sentence the page and the document both carry: what the tool does and what it leaves to people. */
export const RISK_SCOPE_TEXT =
  "The tool calculates scores from the method you define. It does not judge whether a risk is acceptable; that decision belongs to your team and your quality system (ICH Q9(R1)).";

/** Assessment list and create page (no `ra` parameter) or the editor of one assessment. */
export function RiskPage({ params }: { params: URLSearchParams }) {
  const project = useStore((s) => s.project)!;
  const id = params.get("ra");
  const a = id ? project.risk.assessments.find((x) => x.id === id) : undefined;
  const tab = params.get("tab");
  return a ? <Editor a={a} initialTab={TABS.includes(tab as Tab) ? (tab as Tab) : "method"} /> : <List missing={id ?? undefined} />;
}

function List({ missing }: { missing?: string | undefined }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const content = useContent();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const list = project.risk.assessments;

  function create() {
    if (!title.trim()) return setError("Enter a title for the assessment.");
    let newId = "";
    const err = update((p, actor) => {
      // One-time copy of the project scope's steps; after this the assessment's steps are its own.
      const r = createAssessment(p, { title: title.trim(), steps: projectScopeSteps(content, p) }, actor);
      newId = r.assessmentId;
      return r.project;
    }, "Risk assessment created");
    if (err) return setError(err);
    setTitle("");
    setError("");
    navigate("/risk", { ra: newId, tab: "method" });
  }

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>Risk assessment</h1>
      </PageBanner>
      <section className="card stack" aria-labelledby="ra-about">
        <h2 id="ra-about">What this is</h2>
        <p data-testid="risk-scope-text">{RISK_SCOPE_TEXT}</p>
        <ul className="plain-list">
          <li>You choose the method (FMEA, a risk matrix, your own factors, or plain levels with a written reason). The tool has no default method, scale or bands.</li>
          <li>Items come from the gaps, from a catalog of typical failure modes, from sampling points, or from you. A suggestion becomes an item only when you add it.</li>
          <li>An item without enough answers stays "Not scored" and shows as an open item. The tool never guesses a value.</li>
          <li>The gap severity is shown for reference. It is never copied into a score.</li>
        </ul>
        <p>
          Methods your company has defined are kept on the <a href={href("/risk/methods")}>Method library</a> page.
        </p>
      </section>

      {missing && (
        <p className="notice" role="alert">
          There is no risk assessment {missing} in this project.
        </p>
      )}

      <section className="card stack" aria-labelledby="ra-list">
        <h2 id="ra-list">Risk assessments in this project</h2>
        {list.length === 0 ? (
          <Empty>No risk assessment yet. Create one below.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Risk assessments table" tabIndex={0}>
            <table className="data" data-testid="risk-list">
              <thead>
                <tr>
                  <th scope="col">Assessment</th>
                  <th scope="col">Method</th>
                  <th scope="col">Items</th>
                  <th scope="col">Open items</th>
                  <th scope="col">Last changed</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <th scope="row">
                      <a href={href("/risk", { ra: a.id })}>
                        {a.id}: {a.title}
                      </a>
                    </th>
                    <td className="small">{a.config ? describeMethod(a.config).title : "Not chosen"}</td>
                    <td className="num">{a.items.length}</td>
                    <td className="num">{riskOpenItems(project, a).length}</td>
                    <td className="small">{dateTime(a.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form
          className="row wrap end-align"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label className="field grow">
            <span>New assessment title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fill-finish process risk assessment (fictional)" data-testid="risk-title-input" />
          </label>
          <button type="submit" className="btn primary" data-testid="risk-create">
            Create assessment
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ the editor

function Editor({ a, initialTab }: { a: RiskAssessment; initialTab: Tab }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const [tab, setTab] = useState<Tab>(initialTab);
  // A link to another tab of the assessment that is already open (same page, new address) switches the tab.
  useEffect(() => setTab(initialTab), [initialTab]);
  // Keep the address in step with the tab so a reload or a copied link opens the same tab. replaceState fires no hashchange, so the
  // page is not re-rendered or reset by it.
  const select = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, "", href("/risk", { ra: a.id, tab: t }));
  };
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  /** Runs one edit. Any refusal is shown in words next to the controls. */
  const run: Run = (fn, status) => {
    const err = update(fn, status);
    setError(err ?? "");
    return !err;
  };
  const open = useMemo(() => riskOpenItems(project, a), [project, a]);

  return (
    <div className="stack-lg">
      <PageBanner art="page-document">
        <h1>
          {a.id}: {a.title}
        </h1>
      </PageBanner>
      <p className="no-print">
        <a href={href("/risk")}>All risk assessments</a>
      </p>
      <WhatThisIs id="risk">
        <p>
          A risk assessment (ICH Q9(R1)) lists what could go wrong in the process, scores each item with a method your team chooses, and records the actions that follow. It can draw on the gaps found earlier and on sampling points from the sampling plan, but needs neither.
        </p>
        <p>Next: download the draft from the Output tab for review. The tool reports the band you defined; it never calls a risk acceptable.</p>
      </WhatThisIs>
      <p className="muted" data-testid="risk-scope-text">
        {RISK_SCOPE_TEXT}
      </p>
      {error && (
        <p className="notice" role="alert" data-testid="risk-error">
          {error}
        </p>
      )}

      <DetailsCard a={a} run={run} />

      <section className="card stack" aria-labelledby="ra-open" data-testid="risk-open-items">
        <h2 id="ra-open">Open items ({open.length})</h2>
        {open.length === 0 ? (
          <p>No open items. This says the entries are all there, not that the risks are acceptable; that decision belongs to your team and your quality system.</p>
        ) : (
          <ul className="plain-list small">
            {open.map((o, i) => (
              <li key={i}>{o.text}</li>
            ))}
          </ul>
        )}
      </section>

      <Tabs label="Assessment steps" tabs={TAB_DEFS} selected={tab} onSelect={select} testId="risk-tabs">
        {tab === "method" && (
          <>
            <RiskMethod a={a} run={run} />
            <RiskReview a={a} run={run} />
          </>
        )}
        {tab === "items" && <RiskItems a={a} run={run} />}
        {tab === "actions" && <RiskActions a={a} run={run} />}
        {tab === "output" && <RiskOutput a={a} run={run} />}
      </Tabs>

      <section className="card stack no-print" aria-labelledby="ra-delete">
        <h2 id="ra-delete">Delete this assessment</h2>
        <p className="muted small">The assessment leaves the project. The change log keeps what it said.</p>
        <div>
          <button
            type="button"
            className="btn danger"
            data-testid="risk-delete"
            onClick={(e) => {
              opener.current = e.currentTarget;
              setConfirmDelete(true);
            }}
          >
            Delete assessment
          </button>
        </div>
      </section>

      {confirmDelete && (
        <Modal open onOpenChange={(o) => !o && setConfirmDelete(false)} title="Delete this assessment?" description={`${a.id}: ${a.title} has ${a.items.length} items and ${a.actions.length} actions.`} restoreFocus={() => opener.current}>
          <div className="row end">
            <button type="button" className="btn" autoFocus onClick={() => setConfirmDelete(false)}>
              Keep the assessment
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="risk-delete-confirm"
              onClick={() => {
                setConfirmDelete(false);
                if (run((p, actor) => deleteAssessment(p, a.id, actor), "Risk assessment deleted")) navigate("/risk");
              }}
            >
              Delete assessment
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Title, scope and context. Filled in: a read-only summary with Edit (focus returns to Edit); new: the form opens at once. */
function DetailsCard({ a, run }: { a: RiskAssessment; run: Run }) {
  const [title, setTitle] = useState(a.title);
  const [scope, setScope] = useState(a.scopeNote ?? "");
  const [context, setContext] = useState(a.context ?? "");
  const [mode, setMode] = useState<"first" | "edit" | undefined>(a.scopeNote?.trim() ? undefined : "first");
  const rootRef = useRef<HTMLElement>(null);
  const focusNext = useRef<"title" | "edit" | null>(null);
  const editing = mode !== undefined;
  useEffect(() => {
    const f = focusNext.current;
    if (!f) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-testid="${f === "title" ? "risk-title" : "risk-details-edit"}"]`)?.focus();
    focusNext.current = null;
  }, [editing]);
  const close = () => {
    focusNext.current = "edit";
    setMode(undefined);
  };

  if (!editing) {
    return (
      <section className="card stack" aria-labelledby="ra-details" ref={rootRef}>
        <h2 id="ra-details">Assessment details</h2>
        <div className="batch-summary" role="group" aria-label="Assessment details summary" data-testid="risk-details-summary">
          <dl>
            <div>
              <dt>Title:</dt>
              <dd>
                <strong>{a.title}</strong>
              </dd>
            </div>
            <div>
              <dt>Purpose and scope:</dt>
              <dd>{a.scopeNote?.trim() ? a.scopeNote : "not given"}</dd>
            </div>
            {a.context ? (
              <div>
                <dt>Context:</dt>
                <dd className="muted">{a.context}</dd>
              </div>
            ) : null}
          </dl>
          <div className="batch-actions">
            <button
              type="button"
              className="btn"
              aria-label="Edit assessment details"
              data-testid="risk-details-edit"
              onClick={() => {
                focusNext.current = "title";
                setMode("edit");
              }}
            >
              Edit
            </button>
          </div>
        </div>
      </section>
    );
  }

  const dirty = title !== a.title || scope !== (a.scopeNote ?? "") || context !== (a.context ?? "");
  return (
    <section className="card stack" aria-labelledby="ra-details" ref={rootRef}>
      <h2 id="ra-details">Assessment details</h2>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="risk-title" />
      </label>
      <label className="field">
        <span>Purpose and scope</span>
        <textarea rows={3} value={scope} onChange={(e) => setScope(e.target.value)} data-testid="risk-scope" />
        <span className="muted small">What is being assessed and why. Written by your team; the tool does not suggest it.</span>
      </label>
      <label className="field">
        <span>
          Context <span className="muted">(optional)</span>
        </span>
        <textarea rows={2} value={context} onChange={(e) => setContext(e.target.value)} />
      </label>
      <div className="row wrap">
        <button
          type="button"
          className="btn primary"
          data-testid="risk-details-save"
          disabled={!dirty || !title.trim()}
          onClick={() => {
            if (run((p, actor) => updateAssessment(p, a.id, { title, scopeNote: scope, context }, actor), "Assessment details saved")) close();
          }}
        >
          Save details
        </button>
        {mode === "edit" && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setTitle(a.title);
              setScope(a.scopeNote ?? "");
              setContext(a.context ?? "");
              close();
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
