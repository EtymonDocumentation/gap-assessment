import { isAnswered, localDate, tbdItems, tbdSummary, tbdSummaryText } from "@gap/engine";
import { useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { Modal, ResponderForm } from "../components";
import { download, slug, today } from "../lib";
import { href, navigate } from "../router";
import { CloseProjectButton, ProjectListCard, useIsRemote } from "../server/ServerUi";
import { SERVER_MODE } from "../server/mode";
import { content, useAssessment, useContent, useStageWording, useStore } from "../store";

export function HomePage({ notice }: { notice?: string }) {
  const { project, loadDemo, newProject, importJson, setProject } = useStore();
  const a = useAssessment();
  const wording = useStageWording();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Server storage: every project is its own saved project on the server, so nothing is replaced.
  const remote = SERVER_MODE && useIsRemote();
  const confirmReplace = () => remote || !project || window.confirm("This replaces the project currently open in this browser. Export it first if you want to keep it. Continue?");

  const eff = useContent();
  const tbd = useMemo(() => (project && a ? tbdSummary(tbdItems(eff, project, a), localDate()) : null), [eff, project, a]);
  const differences = a?.gaps.filter((g) => g.category !== "equivalent").length ?? 0;

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
      <p className="lede">
        Compare a <strong>sending unit</strong> (SU) process with a planned <strong>receiving unit</strong> (RU) site through a guided interview. The tool
        classifies every difference, builds a gap register and drafts a gap assessment document. Values are never filled in for you: anything
        not yet known stays visible as an open item (TBD).
      </p>

      {project && a ? (
        <section className="card" aria-labelledby="current-h">
          <h2 id="current-h">Open project</h2>
          <p className="project-title">
            {project.meta.title}
            {project.meta.demo && <span className="tag">Fictional demo</span>}
          </p>
          <dl className="stats">
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
          <div className="row wrap">
            <a className="btn primary" href={href("/interview")}>
              Continue interview
            </a>
            <a className="btn" href={href("/scope")}>
              Scope
            </a>
            <a className="btn" href={href("/register")}>
              Gap register
            </a>
            <a className="btn" href={href("/document")}>
              Document
            </a>
            <button className="btn" onClick={() => download(`${slug(project.meta.title)}-${today()}.json`, JSON.stringify(project, null, 2), "application/json")}>
              Export project (JSON)
            </button>
            {remote ? (
              <CloseProjectButton />
            ) : (
              <button className="btn danger" onClick={() => setConfirmDelete(true)}>
                Close and delete…
              </button>
            )}
          </div>
        </section>
      ) : null}

      {remote && <ProjectListCard />}

      <section className="card" aria-labelledby="start-h">
        <h2 id="start-h">Start</h2>
        <div className="start-grid">
          <div className="start-option">
            <h3>Load the demo project</h3>
            <p className="muted">
              ARX-217, a fictional liquid mAb in 2R vials, moving from Site North Line 2 to Site South Line 4. It covers all eight comparison
              categories.
            </p>
            <button
              className="btn primary"
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
            <h3>Prefilled syringe demo</h3>
            <p className="muted">
              SYR-305, a fictional liquid mAb in a prefilled syringe, filled at a receiving fill site from frozen drug substance. It comes with a
              complete technical requirements document.
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
            <h3>New project</h3>
            <p className="muted">Start an empty interview. Scoping questions come first and decide which unit operations apply.</p>
            <button className="btn" onClick={() => confirmReplace() && setCreating(true)}>
              New project…
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

      <section className="card" aria-labelledby="about-h">
        <h2 id="about-h">About this proof of concept</h2>
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
      </section>

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
