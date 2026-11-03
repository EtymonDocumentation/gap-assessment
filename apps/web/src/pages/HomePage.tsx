import { isAnswered, localDate, openItemsText, PRODUCT_NAME, renameProject, TBD_DEFINITION, tbdItems, tbdSummary } from "@gap/engine";
import { useMemo, useRef, useState } from "react";
import { PageBanner } from "../art";
import { ProductEyebrow } from "../brand";
import { thenStep } from "../chain";
import { DEMO_NAMES, type DemoId } from "../demo-build";
import { DocChainStrip, useChainAllowed } from "../DocChain";
import { InlineRename, Modal, ResponderForm } from "../components";
import { download, projectFileStem, today } from "../lib";
import { documentDownloadedNote, interviewCounts, interviewCountsText, nextStep, stepDone } from "../next-step";
import { href, navigate } from "../router";
import { CloseProjectButton, ProjectListCard, useIsRemote } from "../server/ServerUi";
import { SERVER_MODE } from "../server/mode";
import { ensureSaved, loadList, useSync } from "../server/sync";
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
  const { project, openDemo, demoBuilding, homeFlash, listNote, newProject, importJson, setProject, update } = useStore();
  const a = useAssessment();
  const wording = useStageWording();
  const allowed = useChainAllowed();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importError, setImportError] = useState("");
  const [renaming, setRenaming] = useState(false);
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
  // What follows the gap assessment, offered once the interview is complete. Shown beside the gap step, not instead of it: the project cannot show that the register was read.
  const then = project && next?.path === "/register" ? thenStep(project, allowed) : null;
  const firstRecord = project?.mbr.records[0];

  // Opens a demo and, if the user is still where they clicked, lands on Home (the overview of the project). The demo builds away from the page, so the
  // user may have gone elsewhere meanwhile; they are then left where they are and the screen reader line still says the demo is open.
  const startDemo = async (id: DemoId) => {
    if (demoBuilding || !confirmReplace()) return;
    const where = window.location.hash;
    if ((await openDemo(id)) && window.location.hash === where) navigate("/");
  };
  const busy = demoBuilding !== null;

  // Renames the open project. A name another saved project has is refused (server mode), so My projects never shows two projects with one name.
  const saveName = (title: string): string | null => {
    const s = useSync.getState();
    const others = s.list.filter((x) => x.id !== s.projectId).map((x) => x.title);
    return update((p, actor) => renameProject(p, title, actor, { taken: others }), `Renamed: ${title.trim()}`);
  };

  const setHide = (h: boolean) => {
    setHidden(h);
    writeHidden(h);
  };

  // Each item ticks only where the project data proves it; the rest are plain links (no tick never means "not done").
  const checklist: { key: string; label: string; hint: string; path?: string; params?: Record<string, string>; ticked: boolean; note?: string | undefined }[] = [
    { key: "create", label: "Create a project", hint: "Press “Start a new project” at the top of this page. Give it a name and say who is answering.", ticked: !!project },
    { key: "scope", label: "Choose the scope", hint: "Untick the process steps and document sections that do not apply.", path: "/scope", ticked: !!done.scope },
    { key: "interview", label: "Answer the interview", hint: "One question at a time, for the sending and receiving side. Choose TBD for anything not known yet.", path: "/interview", ticked: !!done.interview },
    { key: "register", label: "Review the gap register", hint: "Check every difference the tool found and decide what to do about each.", path: "/register", ticked: !!done.register },
    {
      key: "document",
      label: "Write the gap assessment document",
      hint: "Add your own text, then download the finished document.",
      path: "/document",
      ticked: !!done.document,
      // Downloaded once but items are still open: say so in words instead of a tick (Tester D row 14).
      note: project && a ? documentDownloadedNote(project, a) : undefined,
    },
    // The rest, in the order of the chain strip: the risk assessment sits beside the chain and comes straight after the gap assessment. Every item
    // is optional and can be done in any order, or not at all; a TRD can start blank.
    ...(allowed.risk
      ? [{ key: "risk", label: "Assess risk (optional)", hint: "Rate risks with a method you choose. It sits beside the document chain.", path: "/risk", ticked: !!project && project.risk.assessments.length > 0 }]
      : []),
    ...(allowed.trd
      ? [{ key: "trd", label: "Start the TRD (optional)", hint: "The technical requirements document that follows the gap assessment. It can start from this project or blank.", path: "/trd", ticked: !!project && project.trd.documents.length > 0 }]
      : []),
    ...(allowed.sampling
      ? [{ key: "sampling", label: "Make a sampling plan (optional)", hint: "Where and when samples are taken in the PPQ (process performance qualification) batches.", path: "/sampling", ticked: !!project && project.sampling.plans.length > 0 }]
      : []),
    ...(allowed.mbr
      ? [
          { key: "mbr", label: "Write the batch record (optional)", hint: "The step-by-step instruction for making one batch. It can use a TRD and a sampling plan, or start blank.", path: "/mbr", ticked: !!firstRecord },
          {
            key: "view",
            label: "See the Process view (optional)",
            hint: "A batch record drawn as an equipment train, with its clocks and samples. It opens from a batch record.",
            path: firstRecord ? "/mbr/view" : "/mbr",
            ...(firstRecord ? { params: { mbr: firstRecord.id } } : {}),
            ticked: false,
          },
        ]
      : []),
  ];

  return (
    <div className="stack-lg">
      <PageBanner art="page-home-hero" size="hero">
        <ProductEyebrow />
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
          questions, lists every difference (gap), and drafts the gap assessment and the follow-on documents. They run in a chain, and every stage is optional: gap assessment, technical requirements document (TRD), sampling plan, batch record, then the Process view of the batch record. A risk assessment sits beside the chain.
        </p>
        <p className="muted">
          Anything not yet known is marked TBD and stays visible as an open item. {TBD_DEFINITION} The tool never fills in values for you.
        </p>
        <div className="start-grid" data-testid="start-options">
          <div className="start-option">
            <button className="btn primary big" disabled={busy} onClick={() => confirmReplace() && setCreating(true)}>
              Start a new project
            </button>
            <p className="muted small">Name it and say who is answering. Then you choose the scope and answer the guided questions.</p>
          </div>
          <div className="start-option">
            <button className="btn big" disabled={busy} onClick={() => void startDemo("arx-217")}>
              Open demo: {DEMO_NAMES["arx-217"]}
            </button>
            <p className="muted small">
              A fictional liquid mAb in 2R vials moving between two sites. It shows every kind of difference the tool can find (all eight comparison categories), so it is a good way to
              see the gap assessment from start to finish. It also carries a short TRD, batch record, sampling plan and risk assessment.
            </p>
          </div>
          <div className="start-option">
            <button className="btn big" disabled={busy} onClick={() => void startDemo("syr-305")}>
              Open demo: {DEMO_NAMES["syr-305"]}
            </button>
            <p className="muted small">
              A fictional prefilled syringe, filled at a receiving fill site from frozen drug substance. The whole document chain is filled in (a complete TRD, batch record, sampling
              plan and risk assessment), so it is a good way to see the follow-on documents.
            </p>
          </div>
        </div>
        {/* A status region that is always on the page, so a screen reader announces the text when it appears. */}
        <div role="status" data-testid="demo-status">
          {demoBuilding && <p className="notice">Building the demo: {demoBuilding}…</p>}
        </div>
        {homeFlash && (
          <p className="notice" data-testid="demo-opened">
            {homeFlash}
          </p>
        )}
        <p className="muted small">
          Both demos are fictional. {remote ? "Opening one adds it to your projects on the server." : "Opening one replaces the project open in this browser (you are asked first)."}
        </p>
      </section>

      {project && a && next ? (
        <section className="card stack" aria-labelledby="current-h" data-testid="open-project">
          <h2 id="current-h">Open project</h2>
          <div className="project-title-row">
            {renaming ? (
              <InlineRename
                current={project.meta.title}
                label={project.meta.title}
                save={saveName}
                onClose={() => {
                  setRenaming(false);
                  window.setTimeout(() => document.getElementById("rename-open-project")?.focus(), 0);
                }}
              />
            ) : (
              <>
                <p className="project-title">
                  {project.meta.title}
                  {project.meta.demo && <span className="tag">Fictional demo</span>}
                </p>
                <button type="button" className="btn small" id="rename-open-project" aria-label={`Rename ${project.meta.title}`} onClick={() => setRenaming(true)}>
                  Rename
                </button>
              </>
            )}
          </div>
          <div className="next-step" data-testid="next-step">
            <p className="next-step-label">Next step</p>
            <div className="row wrap">
              <a className="btn primary big" href={href(next.path)}>
                {next.label}
              </a>
              <a href={href("/document")}>Go to the document</a>
            </div>
            {then && (
              <p className="small" data-testid="then-step">
                After that (optional): <a href={href(then.path, then.params)}>{then.label}</a>
              </p>
            )}
          </div>
          <dl className="stats stats-quiet">
            <div>
              <dt>Questions answered</dt>
              <dd>{interviewCountsText(interviewCounts(project, a.instances))}</dd>
            </div>
            <div>
              <dt>Differences</dt>
              <dd>{differences}</dd>
            </div>
            <div>
              <dt>Open items</dt>
              <dd>
                {/* The two counts sit together and say how they relate: every value marked TBD is an open item, and so is every question not answered yet. */}
                {tbd ? <a href={href("/tbd")}>{openItemsText(a.openItems.length, tbd.total)}</a> : a.openItems.length}
                {tbd && tbd.overdue > 0 && <span className="small"> ({tbd.overdue} overdue)</span>}
              </dd>
            </div>
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
            <button className="btn small" onClick={() => download(`${projectFileStem(project.meta)}-${today()}.json`, JSON.stringify(project, null, 2), "application/json")}>
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

      {project && (
        <section className="card stack" aria-labelledby="chain-h" data-testid="home-chain">
          <h2 id="chain-h">Your documents</h2>
          <DocChainStrip heading={false} />
          <p className="muted small">
            Each document can use the one before it, but none is required: a TRD can start blank, and you can skip the gap assessment. Anything not yet known stays visible as an open item.
          </p>
          {allowed.trd && (
            <div className="chain-card-actions">
              {project.trd.documents.length > 0 ? (
                <>
                  {/* The project already has a TRD, so offering to start one would hide the way back to it. */}
                  <a className="btn" href={project.trd.documents.length === 1 ? href("/trd", { trd: project.trd.documents[0]!.id }) : href("/trd")} data-testid="home-start-trd">
                    {project.trd.documents.length === 1 ? "Open the TRD" : "Open the TRDs"}
                  </a>
                  <span className="muted small">Opens {project.trd.documents.length === 1 ? "the TRD" : "the list of TRDs"} of this project.</span>
                </>
              ) : (
                <>
                  <a className="btn" href={href("/trd")} data-testid="home-start-trd">
                    Start from a TRD
                  </a>
                  <span className="muted small">Opens the TRD page, where you choose how it starts: from this project, from a seed file, or blank.</span>
                </>
              )}
            </div>
          )}
        </section>
      )}

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
                    <a href={href(c.path, c.params)}>{c.label}</a>
                  ) : (
                    <strong>{c.label}</strong>
                  )}
                  {c.ticked && <span className="visually-hidden"> (done)</span>}
                  {c.note && <span className="muted small"> ({c.note})</span>}
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

      <section className="card stack" aria-labelledby="import-h">
        <h2 id="import-h">Import a project</h2>
        <p className="muted small">Open a project JSON file exported from this tool. It is validated before it opens.</p>
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
            useStore.setState({ listNote: null });
            // The names already in My projects decide whether the imported one needs "(imported)"; make sure the list has been read.
            if (remote && useSync.getState().listState !== "ready") await loadList();
            const r = importJson(await f.text(), useSync.getState().list.map((x) => x.title));
            if (r.error !== null) {
              setImportError(r.error);
              return;
            }
            setImportError("");
            // The person stays on this page (it used to jump to the Interview with no message). The line says what was made, and in server mode
            // My projects marks the new row once the server has saved it.
            const text = r.title === r.fileTitle ? `Imported: ${r.fileTitle}` : `Imported: ${r.fileTitle}. A project with this name is already listed, so this one is called ${r.title}.`;
            useStore.setState({ listNote: { text } });
            if (remote) {
              const id = await ensureSaved().catch(() => null);
              if (id) useStore.setState({ listNote: { text, newId: id } });
            }
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
        {/* Without a My projects list (one project in this browser) the line sits here; with one, the list shows it beside the new row. */}
        <div role="status" data-testid="import-result">
          {!remote && listNote && <p className="notice">{listNote.text}</p>}
        </div>
      </section>

      <details className="card about" data-testid="about-poc">
        <summary>
          <h2 id="about-h">About {PRODUCT_NAME}</h2>
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
