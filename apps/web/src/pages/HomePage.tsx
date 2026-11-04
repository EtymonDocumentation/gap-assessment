import { localDate, openItemsText, PRODUCT_NAME, PRODUCT_SUBTITLE, renameProject, tbdItems, tbdSummary } from "@gap/engine";
import { useMemo, useRef, useState } from "react";
import { thenStep, chainStages } from "../chain";
import { useChainAllowed } from "../DocChain";
import { InlineRename, Modal } from "../components";
import { download, projectFileStem, today } from "../lib";
import { interviewCounts, interviewCountsText, nextStep } from "../next-step";
import { href } from "../router";
import { CloseProjectButton, ProjectListCard, useIsRemote } from "../server/ServerUi";
import { SERVER_MODE } from "../server/mode";
import { ensureSaved, loadList, useSync } from "../server/sync";
import { StageCheckNotice, StageRow } from "../stage-ui";
import { SamplingFormButton, SamplingUploadButton } from "./SamplingUploadButton";
import { StartChoices } from "./StartChoices";
import { TrdFormButton, TrdUploadButton } from "./TrdUploadButton";
import { content, useAssessment, useContent, useStageWording, useStore } from "../store";

/** One card per document of the chain. The buttons go to the document's own page; "Not started" says so in words and the button says Start. */
interface DocCardSpec {
  id: "gap" | "trd" | "sampling" | "mbr" | "risk";
  name: string;
  purpose: string;
  path: string;
  params?: Record<string, string>;
}

const CARD_PURPOSE: Record<DocCardSpec["id"], string> = {
  gap: "Compare the sending and receiving unit and list every difference.",
  trd: "The technical requirements: what the receiving site has to meet. Start from a project, a document you have, or blank.",
  sampling: "Where and when samples are taken in the PPQ (process performance qualification) batches.",
  mbr: "The step-by-step instruction for making one batch.",
  risk: "Rate what could go wrong with a method you choose.",
};

export function HomePage() {
  const { project, importJson, setProject, update, listNote } = useStore();
  const a = useAssessment();
  const wording = useStageWording();
  const allowed = useChainAllowed();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importError, setImportError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Server storage: every project is its own saved project on the server, so nothing is replaced.
  const remote = SERVER_MODE && useIsRemote();
  const confirmReplace = () => remote || !project || window.confirm("This replaces the project currently open in this browser. Export it first if you want to keep it. Continue?");

  const eff = useContent();
  const tbd = useMemo(() => (project && a ? tbdSummary(tbdItems(eff, project, a), localDate()) : null), [eff, project, a]);
  const differences = a?.gaps.filter((g) => g.category !== "equivalent").length ?? 0;
  const next = project && a ? nextStep(project, a) : null;
  // What follows the gap assessment, offered once the interview is complete. Shown beside the gap step, not instead of it: the project cannot show that the register was read.
  const then = project && next?.path === "/register" ? thenStep(project, allowed) : null;
  const firstRecord = project?.mbr.records[0];

  // The state line of each card is the one the chain strip shows on the document pages, so Home and the pages never disagree.
  const stages = useMemo(() => (project ? chainStages(project, a, allowed) : []), [project, a, allowed]);
  const statusOf = (id: DocCardSpec["id"]) => stages.find((s) => s.id === id)?.status;
  const cards: DocCardSpec[] = [
    { id: "gap", name: "Gap assessment", purpose: CARD_PURPOSE.gap, path: "/gap" },
    ...(allowed.trd
      ? [
          {
            id: "trd" as const,
            name: "TRD",
            purpose: CARD_PURPOSE.trd,
            path: "/trd",
            // One TRD opens straight away; with several the list lets the person choose.
            ...(project?.trd.documents.length === 1 ? { params: { trd: project.trd.documents[0]!.id } } : {}),
          },
        ]
      : []),
    ...(allowed.sampling ? [{ id: "sampling" as const, name: "Sampling plan", purpose: CARD_PURPOSE.sampling, path: "/sampling" }] : []),
    ...(allowed.mbr ? [{ id: "mbr" as const, name: "Batch record", purpose: CARD_PURPOSE.mbr, path: "/mbr" }] : []),
    ...(allowed.risk ? [{ id: "risk" as const, name: "Risk assessment", purpose: CARD_PURPOSE.risk, path: "/risk" }] : []),
  ];
  /** The card's button: Start for a document that has not been started, Continue for a gap assessment with open questions, Open otherwise. */
  const buttonOf = (c: DocCardSpec): string => {
    const status = statusOf(c.id);
    if (!project || status === undefined || status === "Not started") return "Start";
    return c.id === "gap" && /still open/.test(status) ? "Continue" : "Open";
  };

  // Renames the open project. A name another saved project has is refused (server mode), so My projects never shows two projects with one name.
  const saveName = (title: string): string | null => {
    const s = useSync.getState();
    const others = s.list.filter((x) => x.id !== s.projectId).map((x) => x.title);
    return update((p, actor) => renameProject(p, title, actor, { taken: others }), `Renamed: ${title.trim()}`);
  };

  // The upload choice is left out when a project is open and the account can upload nothing: a card that only says "nothing here" is noise.
  const canUpload = !project || allowed.trd || allowed.sampling;
  const startChoices = (
    <StartChoices compact={!!project}>
              {/* The third choice. An upload is read into the open project (the review page needs one), so without a project it says what to do first. */}
              {canUpload && (
              <div className="start-option start-upload" role="group" aria-labelledby="start-upload-h">
                <h3 id="start-upload-h" className="start-option-title">
                  Upload a document you have
                </h3>
                {project ? (
                  <>
                    {allowed.trd && (
                      <div className="stack" data-testid="home-start-from-document">
                        <h4 className="start-sub">Start from a document you have</h4>
                        <p className="muted small">Upload a TRD Word file that this tool made, or fill in the blank TRD form and upload that. You check every value before it is used.</p>
                        <div className="row wrap">
                          <TrdUploadButton className="btn" testId="home-upload-trd" />
                          <TrdFormButton testId="home-blank-form" />
                        </div>
                      </div>
                    )}
                    {allowed.sampling && (
                      <div className="stack" data-testid="home-start-from-sampling-document">
                        <h4 className="start-sub">Start a sampling plan from a document you have</h4>
                        <p className="muted small">Upload a sampling plan Word file that this tool made, a fill-in form, or a plan in another layout (Word or PDF). You check every value before it is used.</p>
                        <div className="row wrap">
                          <SamplingUploadButton className="btn" testId="home-upload-sampling" />
                          <SamplingFormButton testId="home-sampling-blank-form" />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="muted small" data-testid="upload-needs-project">
                    A finished TRD or sampling plan is read into a project, so open a demo or start a new project first. Then this choice offers the upload.
                  </p>
                )}
              </div>
              )}
</StartChoices>
  );

  return (
    <div className="stack-lg">
      {/* The projects list is a side column on a wide screen (it used to sit at the top, between the person and the buttons they came for). In
          the page it comes after the main column, so on a phone and a tablet it is below everything the person came to do. In this browser's own
          storage there is only the open project (its card is in the main column), so the side column is left out. */}
      <div className={`home-layout${remote ? " has-side" : ""}`}>
        <div className="home-main stack-lg">
          <section className="stack home-welcome" aria-labelledby="welcome-h">
            <p className="eyebrow">
              {PRODUCT_NAME} · {PRODUCT_SUBTITLE}
            </p>
            <h1 id="welcome-h">Welcome to {PRODUCT_NAME}</h1>
            <p className="lede">
              Cascade helps you write the documents of a GMP technology transfer. It asks guided questions, lists the differences between the sending and the receiving site, and
              drafts the documents from your answers. Every document is optional, and anything not yet known stays visible as an open item.
            </p>
          </section>

          {!project && (
            <section className="card stack" aria-labelledby="start-h">
              <h2 id="start-h">Start</h2>
              {startChoices}
            </section>
          )}

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
              <StageCheckNotice />
              <div className="next-step" data-testid="next-step" data-tour="home-next">
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
                  <dt>Project stage</dt>
                  <dd>
                    <StageRow />
                  </dd>
                </div>
                <div>
                  <dt>Sending-site stage</dt>
                  <dd>{wording.sourceLabel}</dd>
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

          <section className="card stack" aria-labelledby="chain-h" data-testid="home-chain" data-tour="home-chain">
            <h2 id="chain-h">Your documents</h2>
            <p className="muted small">
              {project
                ? "Each document can use the one before it, but none is required: a TRD can start blank, and you can skip the gap assessment. Anything not yet known stays visible as an open item."
                : "One card for each document. The gap assessment can be read now; the others open once a project is open."}
            </p>
            <ul className="doc-cards">
              {cards.map((c) => {
                const status = statusOf(c.id);
                // The gap assessment can be read without a project (its page explains it). The others work on a project's data, so without one
                // the card says so instead of offering a button that would only lead to a "needs an open project" box.
                const usable = c.id === "gap" || !!project;
                return (
                  <li key={c.id} className="doc-card" data-testid={`doc-card-${c.id}`}>
                    <h3>{c.name}</h3>
                    <p className="muted small">{c.purpose}</p>
                    <p className="doc-card-state small" data-testid={`doc-card-state-${c.id}`}>
                      {project ? status : c.id === "gap" ? "Read how it works, then start a project." : "Needs an open project."}
                    </p>
                    {usable && (
                      <div className="doc-card-actions">
                        <a className="btn" href={href(c.path, c.params)} aria-label={`${buttonOf(c)} ${c.name}`} data-testid={`doc-card-open-${c.id}`}>
                          {buttonOf(c)}
                        </a>
                        {c.id === "mbr" && firstRecord && (
                          <a className="small" href={href("/mbr/view", { mbr: firstRecord.id })} data-testid="chain-view">
                            Open the Process view
                          </a>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {project && (
            // With a project open the documents come first; starting something else is one tight section after them, so it is there when
            // wanted but does not push the open project down.
            <details className="card start-else" open data-testid="start-else">
              <summary>
                <h2 id="start-h">Start something else</h2>
              </summary>
              {startChoices}
            </details>
          )}
        </div>
        {remote && (
          <aside className="home-side" aria-label="My projects" data-testid="home-projects" data-tour="home-projects">
            <ProjectListCard />
          </aside>
        )}
      </div>

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
