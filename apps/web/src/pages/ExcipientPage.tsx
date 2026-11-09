import { createExcipientAssessment, excipientMarkers } from "@gap/engine";
import { excipientAssessments } from "@gap/process-model";
import { useState } from "react";
import { StartArt } from "../art";
import { Empty } from "../components";
import { EXCIPIENT_EMPTY_TEXT, EXCIPIENT_NAME, EXCIPIENT_PATH, EXCIPIENT_TABS, assessmentOf, type ExcipientTab } from "../excipient-ui";
import { PageHeader } from "../PageHeader";
import { dateTime } from "../lib";
import { excipientOpenCount, openItemsCount } from "../open-count";
import { href, navigate } from "../router";
import { useStore } from "../store";
import { EXCIPIENT_SCOPE_TEXT, ExcipientEditor } from "./ExcipientEditor";
import type { ExcipientShow } from "./ExcipientInterview";
import { ExcipientLinePage } from "./ExcipientLine";

/** The list of assessments, one assessment (tabs), or one excipient's page, chosen by the address: ?excipient=EXA-001[&tab=...][&line=EXL-001]. */
export function ExcipientPage({ params }: { params: URLSearchParams }) {
  const project = useStore((s) => s.project)!;
  const id = params.get("excipient");
  const a = assessmentOf(project, id);
  const tab = params.get("tab");
  const show = params.get("show");
  const question = params.get("q");
  const lineId = params.get("line");
  const line = a?.lines.find((l) => l.id === lineId);
  if (a && line) return <ExcipientLinePage a={a} line={line} />;
  if (a)
    return (
      <ExcipientEditor
        a={a}
        initialTab={EXCIPIENT_TABS.includes(tab as ExcipientTab) ? (tab as ExcipientTab) : "excipients"}
        {...(show === "open" || show === "all" ? { initialShow: show as ExcipientShow } : {})}
        {...(question ? { initialQuestion: question } : {})}
        {...(params.get("of") ? { initialLine: params.get("of")! } : {})}
      />
    );
  return <List missing={id ?? undefined} />;
}

function List({ missing }: { missing?: string | undefined }) {
  const project = useStore((s) => s.project)!;
  const update = useStore((s) => s.update);
  const [error, setError] = useState("");
  const list = excipientAssessments(project);

  // Both starts make the same empty assessment, named after the project (renamed on the first tab); they differ only in the tab that opens.
  // Nothing is chosen for the person: no excipient, no class, no answer.
  function start(tab: ExcipientTab) {
    let newId = "";
    const err = update((p, actor) => {
      const r = createExcipientAssessment(p, { title: `${p.meta.title} excipient assessment` }, actor);
      newId = r.assessmentId;
      return r.project;
    }, "Excipient assessment created");
    if (err) return setError(err);
    setError("");
    navigate(EXCIPIENT_PATH, { excipient: newId, tab });
  }

  return (
    <div className="stack-lg" data-testid="ex-list">
      <PageHeader
        title={EXCIPIENT_NAME}
        purpose="Compare the excipients of the product between the sending and the receiving site."
        about={{
          art: "page-document",
          children: (
            <>
              <p>An excipient is any ingredient of the product that is not the active substance. For each one you note the supplier, grade, origin and specification at both sites, and the tool shows what differs.</p>
              <p data-testid="ex-scope-text">{EXCIPIENT_SCOPE_TEXT}</p>
            </>
          ),
        }}
      />
      {list.length === 0 && <StartArt art="page-document" />}
      {missing && (
        <p className="notice" role="alert">
          There is no excipient assessment {missing} in this project.
        </p>
      )}
      {error && (
        <p className="error" role="alert" data-testid="ex-start-error">
          {error}
        </p>
      )}

      <section aria-labelledby="ex-starts-h" data-tour="excipient-starts">
        <h2 id="ex-starts-h">How do you want to start?</h2>
        <p className="small" data-testid="ex-empty-text">
          {EXCIPIENT_EMPTY_TEXT}
        </p>
        <div className="ex-starts">
          <div className="card stack">
            <h3>Start blank</h3>
            <p className="small">An empty assessment. You add the excipients by name.</p>
            <div>
              <button type="button" className="btn primary" onClick={() => start("excipients")} data-testid="ex-start-blank">
                Start blank
              </button>
            </div>
          </div>
          <div className="card stack">
            <h3>Start from the library</h3>
            <p className="small">Pick excipients from a ready-made list.</p>
            <div>
              <button type="button" className="btn" disabled aria-describedby="ex-library-note" data-testid="ex-start-library">
                Start from the library
              </button>
            </div>
            <p className="muted small" id="ex-library-note" data-testid="ex-library-note">
              The excipient library comes next
            </p>
          </div>
          <div className="card stack">
            <h3>Answer questions</h3>
            <p className="small">No document needed. You answer plain questions and the assessment fills itself in.</p>
            <div>
              <button type="button" className="btn primary" onClick={() => start("questions")} data-testid="ex-start-questions">
                Answer questions
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="card stack" aria-labelledby="ex-list-h">
        <h2 id="ex-list-h">Excipient assessments in this project</h2>
        {list.length === 0 ? (
          <Empty>No excipient assessment yet. Start one above.</Empty>
        ) : (
          <div className="table-scroll" role="region" aria-label="Excipient assessments table" tabIndex={0}>
            <table className="data" data-testid="ex-list-table">
              <thead>
                <tr>
                  <th scope="col">Assessment</th>
                  <th scope="col">Excipients</th>
                  <th scope="col">What differs</th>
                  <th scope="col">Open items</th>
                  <th scope="col">Last changed</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => {
                  const differs = a.lines.filter((l) => excipientMarkers(project, a.id, l).length > 0).length;
                  const n = excipientOpenCount(project, a);
                  return (
                    <tr key={a.id}>
                      <th scope="row">
                        <a href={href(EXCIPIENT_PATH, { excipient: a.id })} data-testid="ex-list-link">
                          {a.id}: {a.title}
                        </a>
                      </th>
                      <td className="num">{a.lines.length}</td>
                      <td className="small">{differs === 0 ? "Nothing yet" : `${differs} ${differs === 1 ? "excipient" : "excipients"}`}</td>
                      <td>
                        <span data-testid="ex-list-open">{openItemsCount(n)}</span>
                      </td>
                      <td className="small">{dateTime(a.updatedAt)}</td>
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
