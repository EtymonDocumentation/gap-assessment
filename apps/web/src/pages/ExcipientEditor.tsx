import { deleteExcipientAssessment, excipientMarkers, excipientOpenItems, updateExcipientAssessment } from "@gap/engine";
import type { ExcipientAssessment } from "@gap/process-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { EXCIPIENT_PATH, EXCIPIENT_TABS, EXCIPIENT_TAB_LABEL, KIND_TEXT, classText, factCell, openItemQuestionKey, useExcipientQuestions, type ExcipientTab } from "../excipient-ui";
import { PageHeader, type PagePill } from "../PageHeader";
import { Tabs, type TabDef } from "../Tabs";
import { landAtTop } from "../land-at-top";
import { dateTime } from "../lib";
import { openItemsCount } from "../open-count";
import { href, navigate } from "../router";
import { useStore } from "../store";
import { AddExcipientForm } from "./ExcipientAdd";
import { ExcipientInterview, type ExcipientShow } from "./ExcipientInterview";
import { ExcipientSpecs } from "./ExcipientSpecs";
import { ReasonDialog } from "./ReasonDialog";

const TAB_INFO: Omit<TabDef<ExcipientTab>, "label">[] = [
  {
    id: "excipients",
    testId: "ex-tab-excipients",
    purpose: "The excipients of the product, one line each. Add one by name; the details come from the questions.",
    help: "An excipient is any ingredient that is not the active substance. Each line shows its role, its supplier at both sites and what differs between them. Select a name to see everything about that excipient.",
  },
  {
    id: "questions",
    testId: "ex-tab-questions",
    purpose: "Answer plain questions and the assessment fills itself in. Anything you don't know stays open.",
    help: "The same assessment as the other tabs. Every answer is written into it at once. Don't know yet leaves the question open. Not applicable here is an answer, and so is Same as the sending site. Switch on Show one question at a time to go through them one by one.",
  },
  {
    id: "specs",
    testId: "ex-tab-specs",
    purpose: "Compare the tests and limits of the sending and the receiving site's specification.",
    help: "Write what each site's specification says, exactly as written. The tool compares the two and says what it sees; it does not say whether a difference is acceptable.",
  },
  {
    id: "open",
    testId: "ex-tab-open",
    purpose: "Everything still missing: facts not established, to be decided, tests not compared and excipients with no document cited.",
    help: "A to-do list built from the assessment. The count in the tab name goes down as you fill things in.",
  },
  {
    id: "document",
    testId: "ex-tab-document",
    purpose: "The written document of this assessment.",
    help: "The document with its download comes later. Everything entered here will be in it.",
  },
];

export const EXCIPIENT_SCOPE_TEXT =
  "The excipient assessment is your record. The tool compares what you enter and shows what differs between the sending and the receiving site. It does not decide a filing category; where a difference calls for it, it says: Requires regulatory affairs assessment.";

export function ExcipientEditor({ a, initialTab, initialShow, initialQuestion, initialLine }: { a: ExcipientAssessment; initialTab: ExcipientTab; initialShow?: ExcipientShow; initialQuestion?: string; initialLine?: string }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const [tab, setTab] = useState<ExcipientTab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  // The question an Open items entry points to. Used once: choosing a tab by hand drops it, so the Questions tab does not jump back to it later.
  const [jump, setJump] = useState<string | undefined>(initialQuestion);
  const [specLine, setSpecLine] = useState<string | undefined>(initialLine);
  useEffect(() => setSpecLine(initialLine), [initialLine]);
  useEffect(() => {
    if (!initialQuestion) landAtTop();
  }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useMemo(() => excipientOpenItems(project, a), [project, a]);
  const count = open.length;
  const select = (t: ExcipientTab) => {
    setTab(t);
    setJump(undefined);
    window.history.replaceState(null, "", href(EXCIPIENT_PATH, { excipient: a.id, tab: t }));
  };
  const tabDefs = EXCIPIENT_TABS.map((id) => TAB_INFO.find((t) => t.id === id)!).map((t) => ({ ...t, label: `${EXCIPIENT_TAB_LABEL[t.id]}${t.id === "open" ? ` (${count})` : ""}` }));
  const pills: PagePill[] = [
    { label: `${a.lines.length} ${a.lines.length === 1 ? "excipient" : "excipients"}`, testId: "ex-pill-lines" },
    { label: openItemsCount(count), warning: count > 0, testId: "ex-pill-open" },
  ];
  const run = (fn: Parameters<typeof update>[0], status: string) => {
    const err = update(fn, status);
    setError(err ?? "");
    return err;
  };
  const goToLineSpecs = (lineId: string) => {
    setSpecLine(lineId);
    select("specs");
  };

  return (
    <div className="stack-lg" data-testid="ex-editor">
      <PageHeader
        title={a.title}
        crumb={a.id}
        purpose="The excipients of the product, compared between the sending and the receiving site."
        pills={pills}
        meta={`Last changed ${dateTime(a.updatedAt)}`}
        about={{
          art: "page-document",
          children: (
            <>
              <p>An excipient is any ingredient of the product that is not the active substance. This assessment lists each one with its supplier, grade, origin and specification at both sites, and shows what differs.</p>
              <p data-testid="ex-scope-text">{EXCIPIENT_SCOPE_TEXT}</p>
            </>
          ),
        }}
      />
      {error && (
        <p className="notice" role="alert" data-testid="ex-error">
          {error}
        </p>
      )}

      <Tabs label="Excipient assessment steps" tabs={tabDefs} selected={tab} onSelect={select} testId="ex-tabs" tour="excipient-tabs">
        {tab === "excipients" && <ExcipientsTab a={a} run={run} />}
        {tab === "questions" && <ExcipientInterview a={a} {...(initialShow ? { initialShow } : {})} {...(jump ? { initialQuestion: jump } : {})} />}
        {tab === "specs" && <ExcipientSpecs a={a} lineId={specLine} onPick={setSpecLine} />}
        {tab === "open" && (
          <section className="card stack" aria-labelledby="ex-open-h" data-testid="ex-open-items">
            <h2 id="ex-open-h">{openItemsCount(count)}</h2>
            {count === 0 ? (
              <p>No open items. This says the entries are all there, not that they are right; that decision belongs to your team and your quality system.</p>
            ) : (
              <>
                <p className="muted small">Select an entry to go to the place that holds it.</p>
                <ul className="plain-list small">
                  {open.map((o, i) => {
                    const q = openItemQuestionKey(o);
                    const to: Record<string, string> = q ? { tab: "questions", q } : o.rowId ? { tab: "specs", of: o.lineId } : { line: o.lineId };
                    return (
                      <li key={i}>
                        <strong>{KIND_TEXT[o.kind]}:</strong>{" "}
                        <a
                          href={href(EXCIPIENT_PATH, { excipient: a.id, ...to })}
                          data-testid="ex-open-link"
                          onClick={(e) => {
                            if (q) {
                              e.preventDefault();
                              setTab("questions");
                              setJump(q);
                              window.history.replaceState(null, "", href(EXCIPIENT_PATH, { excipient: a.id, tab: "questions" }));
                            } else if (o.rowId) {
                              e.preventDefault();
                              goToLineSpecs(o.lineId);
                            }
                          }}
                        >
                          {o.where}
                        </a>
                        {o.kind === "not_established" ? "" : `. ${o.text}.`}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        )}
        {tab === "document" && (
          <section className="card stack" aria-labelledby="ex-doc-h" data-testid="ex-document">
            <h2 id="ex-doc-h">Document</h2>
            <p>The download comes later. Everything you enter here will be in it, and open items will stay visible.</p>
          </section>
        )}
      </Tabs>

      {/* Only on tab 1, where the assessment as a whole is managed: a user comparing a test does not meet a delete-everything box. */}
      {tab === "excipients" && (
        <section className="card stack no-print" aria-labelledby="ex-delete-h">
          <h2 id="ex-delete-h">Delete this assessment</h2>
          <p className="muted small">The assessment leaves the project. The change log keeps what it said and why you removed it.</p>
          <div>
            <button
              type="button"
              className="btn danger"
              data-testid="ex-delete"
              onClick={(e) => {
                opener.current = e.currentTarget;
                setRemoving(true);
              }}
            >
              Delete assessment
            </button>
          </div>
        </section>
      )}
      {removing && (
        <ReasonDialog
          title="Delete this assessment?"
          description={`${a.title} has ${a.lines.length === 1 ? "1 excipient" : `${a.lines.length} excipients`}.`}
          confirmLabel="Delete assessment"
          keepLabel="Keep the assessment"
          testId="ex-delete"
          restoreFocus={() => opener.current}
          onClose={() => setRemoving(false)}
          onConfirm={(reason) => {
            const err = update((p, actor) => deleteExcipientAssessment(p, a.id, reason, actor), "Assessment deleted");
            if (!err) navigate(EXCIPIENT_PATH);
            return err;
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ tab 1: the excipients

function ExcipientsTab({ a, run }: { a: ExcipientAssessment; run: (fn: Parameters<ReturnType<typeof useStore.getState>["update"]>[0], status: string) => string | null }) {
  const project = useStore((s) => s.project)!;
  const questions = useExcipientQuestions(a);
  const [title, setTitle] = useState(a.title);
  const [scope, setScope] = useState(a.scopeNote ?? "");
  const q = (lineId: string, key: string, side: "sending" | "receiving") => questions.find((x) => x.key === `${lineId}/fact:${key}.${side}`);
  const open = useMemo(() => excipientOpenItems(project, a), [project, a]);

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="ex-name-h">
        <h2 id="ex-name-h">Name and scope</h2>
        <label className="field">
          <span>Name of the assessment</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (!title.trim()) return setTitle(a.title);
              if (title.trim() !== a.title) run((p, actor) => updateExcipientAssessment(p, a.id, { title: title.trim() }, actor), "Assessment renamed");
            }}
            data-testid="ex-title"
          />
        </label>
        <label className="field">
          <span>What it covers (optional)</span>
          <textarea rows={2} value={scope} onChange={(e) => setScope(e.target.value)} onBlur={() => scope.trim() !== (a.scopeNote ?? "") && run((p, actor) => updateExcipientAssessment(p, a.id, { scopeNote: scope.trim() }, actor), "Scope saved")} data-testid="ex-scope" />
        </label>
      </section>

      <section className="card stack" aria-labelledby="ex-lines-h">
        <h2 id="ex-lines-h">Excipients</h2>
        {a.lines.length === 0 && (
          <p data-testid="ex-lines-empty">Add the excipients of your product and answer a few questions. Anything you don't know stays open.</p>
        )}
        <AddExcipientForm a={a} />
        {a.lines.length > 0 && (
          <div className="table-scroll" role="region" aria-label="Excipients table" tabIndex={0}>
            <table className="data" data-testid="ex-lines-table">
              <thead>
                <tr>
                  <th scope="col">Excipient</th>
                  <th scope="col">Role</th>
                  <th scope="col">Supplier, sending site</th>
                  <th scope="col">Supplier, receiving site</th>
                  <th scope="col">What differs</th>
                  <th scope="col">Open items</th>
                </tr>
              </thead>
              <tbody>
                {a.lines.map((l) => {
                  const markers = excipientMarkers(project, a.id, l);
                  const cls = classText(l);
                  const s = factCell(q(l.id, "supplier", "sending"));
                  const r = factCell(q(l.id, "supplier", "receiving"));
                  return (
                    <tr key={l.id} data-testid={`ex-line-${l.id}`}>
                      <th scope="row">
                        <a href={href(EXCIPIENT_PATH, { excipient: a.id, line: l.id })} data-testid="ex-line-link">
                          {l.name}
                        </a>
                      </th>
                      <td>{cls ?? <span className="ex-open"><span aria-hidden="true">○</span> Not chosen yet</span>}</td>
                      <td className={s.open ? "ex-open" : ""}>
                        <span aria-hidden="true">{s.icon}</span> {s.text}
                      </td>
                      <td className={r.open ? "ex-open" : ""}>
                        <span aria-hidden="true">{r.icon}</span> {r.text}
                      </td>
                      <td>
                        {markers.length === 0 ? (
                          "None"
                        ) : (
                          <ul className="plain-list small">
                            {markers.map((m) => (
                              <li key={m.key}>
                                <span aria-hidden="true">{m.regulatory ? "▲" : "△"}</span> {m.label}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="num">{open.filter((o) => o.lineId === l.id).length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
