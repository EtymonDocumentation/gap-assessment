import { isAnswered, localDate, tbdItems, tbdSummary, tbdSummaryText } from "@gap/engine";
import { useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Modal, ResponderForm } from "../components";
import { download, slug, today } from "../lib";
import { nextStep, stepDone } from "../next-step";
import { useTrdAllowed } from "../risk-module";
import { href, navigate } from "../router";
import { CloseProjectButton, ProjectListCard, useIsRemote } from "../server/ServerUi";
import { SERVER_MODE } from "../server/mode";
import { content, useAssessment, useContent, useStageWording, useStore } from "../store";

const HIDE_KEY = "gap-getting-started-hidden";

/** The checklist's hidden state is a per-browser convenience; storage can throw (private window, blocked site data), so the card then simply stays shown. */
function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(HIDE_KEY, "1");
    else localStorage.removeItem(HIDE_KEY);
  } catch {
    /* storage unavailable: the choice holds for this visit only */
  }
}

export function HomePage({ notice }: { notice?: string }) {
  const { project, loadDemo, newProject, importJson, setProject } = useStore();
  const a = useAssessment();
  const wording = useStageWording();
  const trdAllowed = useTrdAllowed();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importError, setImportError] = useState("");
  const [hidden, setHidden] = useState(readHidden);
  const fileRef = useRef<HTMLInputElement>(null);

  // Server storage: every project is its own saved project on the server, so nothing is replaced.
  const remote = SERVER_MODE && useIsRemote();
  const confirmReplace = () => remote || !project || window.confirm("This replaces the project currently open in this browser. Export it first if you want to keep it. Continue?");

  const eff = useContent();
  const tbd = useMemo(() => (project && a ? tbdSummary(tbdItems(eff, project, a), localDate()) : null), [eff, project, a]);
  const differences = a?.gaps.filter((g) => g.category !== "equivalent").length ?? 0;
  const next = project && a ? nextStep(project, a) : null;
  const done = project && a ? stepDone(project, a) : {};

  const setHide = (h: boolean) => {
    setHidden(h);
    writeHidden(h);
  };

  // Each item ticks only where the project data proves it; the rest are plain links (no tick never means "not done").
  const checklist: { key: string; label: string; hint: string; path?: string; ticked: boolean }[] = [
    { key: "create", label: "Create a project", hint: "Give it a name and say who is answering.", ticked: !!project },
    { key: "scope", label: "Choose the scope", hint: "Untick the process steps and document sections that do not apply.", path: "/scope", ticked: !!done.scope },
    { key: "interview", label: "Answer the interview", hint: "One question at a time, for the sending and receiving side. Choose TBD for anything not known yet.", path: "/interview", ticked: !!done.interview },
    { key: "register", label: "Review the gap register", hint: "Check every difference the tool found and decide what to do about each.", path: "/register", ticked: false },
    { key: "document", label: "Write the gap assessment document", hint: "Add your own text, then download the finished document.", path: "/document", ticked: false },
    ...(trdAllowed
      ? [{ key: "trd", label: "Start the TRD (optional)", hint: "The technical requirements document that follows the gap assessment.", path: "/trd-seed", ticked: !!project && project.trd.documents.length > 0 }]
      : []),
  ];

  return (
    <div className="stack-lg">
      <PageBanner art="page-home-hero" size="hero">
        <h1>Gap assessment for technology transfer</h1>
      </PageBanner>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <section className="stack home-intro" aria-labelledby="what-h">
        <h2 id="what-h">What this tool does</h2>
        <p className="lede">
          You compare how a product is made at the <strong>sending unit</strong> (SU) with how the <strong>receiving unit</strong> (RU) site plans to make it. The tool asks guided
          questions, lists every difference (gap), and drafts the gap assessment and the follow-on documents: TRD, batch record, sampling plan and risk assessment.
        </p>
        <p className="muted">Anything not yet known stays visible as an open item (TBD). The tool never fills in values for you.</p>
        <div className="row wrap">
          <button className="btn primary big" onClick={() => confirmReplace() && setCreating(true)}>
            Start a new project
          </button>
        </div>
      </section>

      {project && a && next ? (
        <section className="card stack" aria-labelledby="current-h" data-testid="open-project">
          <h2 id="current-h">Open project</h2>
          <p className="project-title">
            {project.meta.title}
            {project.meta.demo && <span className="tag">Fictional demo</span>}
          </p>
          <div className="next-step" data-testid="next-step">
            <p className="next-step-label">Next step</p>
            <div className="row wrap">
              <a className="btn primary big" href={href(next.path)}>
                {next.label}
              </a>
              <a href={href("/document")}>Go to the document</a>
            </div>
          </div>
          <dl className="stats stats-quiet">
            <div>
              <dt>Questions answered</dt>
              <dd>
                {a.instances.filter((i) => isAnswered(project, i)).length} of {a.instances.length}
              </dd>
            </div>
            <div>
              <dt>Differences</dt>
              <dd>{differences}</dd>
            </div>
            <div>
              <dt>Open information items</dt>
              <dd>{a.openItems.length}</dd>
            </div>
            {tbd && (
              <div>
                <dt>TBD values</dt>
                <dd>
                  <a href={href("/tbd")}>{tbdSummaryText(tbd)}</a>
                </dd>
              </div>
            )}
            <div>
              <dt>Program stage</dt>
              <dd>
                Sending unit (SU): {wording.sourceLabel}
                <br />
                Receiving unit (RU): {wording.targetLabel}
              </dd>
            </div>
            <div>
              <dt>Responder</dt>
              <dd>{project.interview.responder?.name ?? "Not set"}</dd>
            </div>
          </dl>
          <div className="row wrap quiet-actions">
            <button className="btn small" onClick={() => download(`${slug(project.meta.title)}-${today()}.json`, JSON.stringify(project, null, 2), "application/json")}>
              Export project (JSON)
            </button>
            {remote ? (
              <CloseProjectButton />
            ) : (
              <button className="btn small danger" onClick={() => setConfirmDelete(true)}>
                Close and delete…
              </button>
            )}
          </div>
        </section>
      ) : null}

      {remote && <ProjectListCard />}

      {hidden ? (
        <p>
          <button className="link-btn" onClick={() => setHide(false)}>
            Show getting started
          </button>
        </p>
      ) : (
        <section className="card stack" aria-labelledby="started-h" data-testid="getting-started">
          <div className="row between wrap">
            <h2 id="started-h">Getting started</h2>
            <button className="btn small" onClick={() => setHide(true)}>
              Hide
            </button>
          </div>
          <p className="muted small">The steps in order. Each one ticks itself when your project gets there; there is nothing to tick by hand.</p>
          <ol className="checklist">
            {checklist.map((c, i) => (
              <li key={c.key} className={c.ticked ? "is-done" : undefined}>
                {/* A numbered circle, not an empty box: an empty square reads as a checkbox people try to tap, but these marks only follow the project data. */}
                <span className="check-mark" aria-hidden="true">
                  {c.ticked ? "✓" : i + 1}
                </span>
                <div>
                  {c.path && project ? (
                    <a href={href(c.path)}>{c.label}</a>
                  ) : c.key === "create" && !project ? (
                    <button className="link-btn" onClick={() => confirmReplace() && setCreating(true)}>
                      {c.label}
                    </button>
                  ) : (
                    <strong>{c.label}</strong>
                  )}
                  {c.ticked && <span className="visually-hidden"> (done)</span>}
                  <p className="muted small">{c.hint}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <details className="card needs" open={!project} data-testid="before-you-start">
        <summary>
          <h2 id="needs-h">Before you start: what you need</h2>
        </summary>
        <ul className="plain-list">
          <li>A project title, and the name (and optionally the role) of the person answering.</li>
          <li>The sending unit process description, and the documents you will cite as sources, such as the process description, a batch record or specifications.</li>
          <li>What the receiving site plans: the filling line, the equipment and the scale.</li>
          <li>Your choice of which process steps and document sections apply (the Scope step asks for this before the interview).</li>
          <li>Unknowns are fine. Choose TBD for anything not known yet: it becomes an open item you can track, and nothing is filled in for you.</li>
        </ul>
      </details>

      <section className="card stack" aria-labelledby="demo-h">
        <h2 id="demo-h">Or try a demo</h2>
        <p className="muted small">
          Both demos are fictional. {remote ? "Opening one adds it to your projects on the server." : "Opening one replaces the project open in this browser (you are asked first)."}
        </p>
        <div className="start-grid">
          <div className="start-option">
            <h3>ARX-217 vials</h3>
            <p className="muted">
              A fictional liquid mAb in 2R vials moving between two sites. It shows every kind of difference the tool can find (all eight comparison categories), so it is a good way to
              see the gap assessment from start to finish. It also carries a short TRD, batch record, sampling plan and risk assessment.
            </p>
            <button
              className="btn"
              onClick={() => {
                if (!confirmReplace()) return;
                loadDemo();
                navigate("/register");
              }}
            >
              Load demo
            </button>
          </div>
          <div className="start-option">
            <h3>SYR-305 syringe</h3>
            <p className="muted">
              A fictional prefilled syringe, filled at a receiving fill site from frozen drug substance. The whole document chain is filled in (a complete TRD, batch record, sampling
              plan and risk assessment), so it is a good way to see the follow-on documents.
            </p>
            <button
              className="btn"
              onClick={() => {
                if (!confirmReplace()) return;
                loadDemo("syr-305");
                navigate("/register");
              }}
            >
              Open syringe example
            </button>
          </div>
          <div className="start-option">
            <h3>Import a project</h3>
            <p className="muted">Open a project JSON file exported from this tool. It is validated before it opens.</p>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              id="import-file"
              aria-label="Project JSON file to import"
              tabIndex={-1}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f || !confirmReplace()) return;
                const err = importJson(await f.text());
                setImportError(err ?? "");
                if (!err) navigate("/interview");
              }}
            />
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Import JSON…
            </button>
            {importError && (
              <p className="error" role="alert">
                Import failed: {importError}
              </p>
            )}
          </div>
        </div>
      </section>

      <details className="card about" data-testid="about-poc">
        <summary>
          <h2 id="about-h">About this proof of concept</h2>
        </summary>
        <ul className="plain-list">
          {remote ? (
            <li>Your projects are saved on the server under your account, as you work. This browser keeps an offline copy of the open project only. Export a project as JSON to share it.</li>
          ) : (
            <li>Your project is stored only in this browser (IndexedDB). Export it as JSON to keep or share it.</li>
          )}
          <li>Every value carries its source: the interview answer, responder and date, plus any document cited.</li>
          <li>Rows that may affect registered information say “Requires regulatory affairs assessment”. The tool never decides filing categories.</li>
          <li>
            Content versions: catalog {content.versions.catalog}, questions {content.versions.questions}, rules {content.versions.rules}, templates{" "}
            {content.versions.templates}.
          </li>
        </ul>
      </details>

      <Modal open={creating} onOpenChange={setCreating} title="New project" description="Name the project and the person answering.">
        <ResponderForm
          withTitle
          submitLabel="Create project"
          onSubmit={(v) => {
            newProject(v.title!, { name: v.name, ...(v.role ? { role: v.role } : {}) });
            setCreating(false);
            // The Scope step comes right after project setup, before the interview, so nobody answers questions about steps they do not have.
            navigate("/scope");
          }}
        />
      </Modal>
      <Modal open={confirmDelete} onOpenChange={setConfirmDelete} title="Close and delete project?" description="This removes the project from this browser. It cannot be undone.">
        <div className="row end">
          <button className="btn" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
          <button
            className="btn danger"
            onClick={() => {
              setProject(null, "Project deleted");
              setConfirmDelete(false);
            }}
          >
            Delete project
          </button>
        </div>
      </Modal>
    </div>
  );
}
