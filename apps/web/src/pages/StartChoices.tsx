import type { ReactNode } from "react";
import { useState } from "react";
import { DEMO_NAMES, demoProjectTitle, type DemoId } from "../demo-build";
import { Modal, ResponderForm } from "../components";
import { href, navigate } from "../router";
import { useIsRemote } from "../server/ServerUi";
import { SERVER_MODE } from "../server/mode";
import { loadList, openProject, useSync } from "../server/sync";
import { useStore } from "../store";
import { useMbrAllowed, useSamplingAllowed, useTrdAllowed } from "../risk-module";

/** The starts that are not the gap assessment (that one is "Start a new project"). The TRD button is the same start as "Answer questions" on the TRD page. */
const DOCUMENT_STARTS: { id: string; title: string; text: string; button: string; path: string; params?: Record<string, string> }[] = [
  { id: "trd", title: "A TRD on its own", text: "Answer plain questions and the TRD fills itself in. Anything you don't know stays open.", button: "Answer questions", path: "/trd", params: { start: "interview" } },
  { id: "sampling", title: "A sampling plan on its own", text: "Say where and when samples are taken. No TRD is needed.", button: "Start a sampling plan", path: "/sampling" },
  { id: "mbr", title: "A batch record from a TRD", text: "It takes its values from a TRD. A sampling plan is welcome but not needed.", button: "Start a batch record", path: "/mbr" },
];

/**
 * The ways to get a project open: start a new one, or open one of the two fictional demos. Home and the "this page needs an open project" box
 * share it, so the buttons, the wording, the busy state and the "building the demo" line are the same wherever a person meets them.
 *
 * `compact` is for Home with a project already open: the person has seen the demos, so each gets one short line instead of its paragraph.
 * `stay` is for the box: the person asked for a particular page, so opening a demo leaves them on that page (the box is simply replaced by it)
 * instead of sending them to Home. A NEW project still goes to the Scope step, because a new project has nothing to show until its scope is
 * chosen. On Home, `stay` is off and a demo lands on Home, the overview of the project.
 */
export function StartChoices({ stay, compact, children }: { stay?: boolean; compact?: boolean; children?: ReactNode }) {
  const { project, openDemo, demoBuilding, homeFlash, newProject } = useStore();
  const [creating, setCreating] = useState(false);
  // The page a "start one document" button was meant for: with no project open the name form comes first, then the person lands there instead of on Scope.
  const [after, setAfter] = useState<{ path: string; params?: Record<string, string> } | null>(null);
  const remote = SERVER_MODE && useIsRemote();
  const busy = demoBuilding !== null;
  // A start is offered only when its module is on for the account (always in the browser-only build).
  const allowed: Record<string, boolean> = { trd: useTrdAllowed(), sampling: useSamplingAllowed(), mbr: useMbrAllowed() };
  const starts = DOCUMENT_STARTS.filter((s) => allowed[s.id]);
  // Server storage: every project is its own saved project on the server, so nothing is replaced.
  const confirmReplace = () => remote || !project || window.confirm("This replaces the project currently open in this browser. Export it first if you want to keep it. Continue?");

  // Opens a demo and, if the person is still where they clicked, lands on Home (the overview of the project). The demo builds away from the page, so
  // the person may have gone elsewhere meanwhile; they are then left where they are and the screen reader line still says the demo is open.
  const startDemo = async (id: DemoId) => {
    if (demoBuilding || !confirmReplace()) return;
    const where = window.location.hash;
    // The projects already in My projects decide whether the demo is opened again (the list is only read in server mode).
    // Read fresh every time: a list read before the first click would not yet hold the demo that click just made.
    if (remote) await loadList();
    // A demo already in My projects is opened again instead of adding another copy next to it (and nothing the person typed into it is lost).
    // A numbered copy from an earlier version of the site ("<name> (2)") counts too; the list is newest first, so the latest one is taken.
    // Someone who wants a clean one deletes or copies the old one from My projects first.
    const own = demoProjectTitle(id);
    const isThisDemo = (title: string) => title === own || (title.startsWith(`${own} (`) && /^\(\d+\)$/.test(title.slice(own.length + 1)));
    const existing = remote ? useSync.getState().list.find((x) => isThisDemo(x.title)) : undefined;
    if (existing) {
      try {
        await openProject(existing.id);
      } catch (e) {
        useStore.setState({ error: `${existing.title} could not be opened. ${(e as Error).message}` });
        return;
      }
      useStore.setState({ homeFlash: `Demo opened: ${DEMO_NAMES[id]}. This is the copy you already had, with your changes.` });
      if (stay) useStore.setState({ homeFlash: "" });
      else if (window.location.hash === where) navigate("/");
      return;
    }
    const opened = await openDemo(id, remote ? useSync.getState().list.map((x) => x.title) : []);
    if (!opened) return;
    if (stay) {
      // The "Demo opened" line belongs to Home; the asked page is on screen now, so it must not be waiting for the next visit to Home.
      useStore.setState({ homeFlash: "" });
    } else if (window.location.hash === where) navigate("/");
  };

  return (
    <>
      <div className="start-grid" data-testid="start-options" data-tour="home-start">
        <div className="start-option">
          <h3 className="start-option-title">Start fresh</h3>
          <button className="btn primary big" disabled={busy} onClick={() => {
              if (!confirmReplace()) return;
              setAfter(null);
              setCreating(true);
            }}>
            Start a new project
          </button>
          <p className="muted small">Name it and say who is answering. Then you choose the scope and answer the guided questions.</p>
        </div>
        {/* The other three starts of the chain, each on its own: no gap assessment is needed for any of them. With a project open the button is a plain
            link; without one it asks for the project name first (a document lives in a project) and then goes to the page. */}
        {!stay && starts.length > 0 && (
          <div className="start-option" role="group" aria-labelledby="start-docs-h" data-testid="start-documents">
            <h3 id="start-docs-h" className="start-option-title">
              Start with one document
            </h3>
            {starts.map((s) => (
              <div className="stack" key={s.id}>
                <h4 className="start-sub">{s.title}</h4>
                <p className="muted small">{s.text}</p>
                {project ? (
                  <a className="btn" href={href(s.path, s.params)} data-testid={`start-doc-${s.id}`}>
                    {s.button}
                  </a>
                ) : (
                  <button
                    className="btn"
                    disabled={busy}
                    data-testid={`start-doc-${s.id}`}
                    onClick={() => {
                      setAfter({ path: s.path, ...(s.params ? { params: s.params } : {}) });
                      setCreating(true);
                    }}
                  >
                    {s.button}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {/* One choice, two demos: each has its own button and a line saying what it shows, so the choice between them is easy. */}
        <div className="start-option start-demos" role="group" aria-labelledby="start-demos-h">
          <h3 id="start-demos-h" className="start-option-title">
            Open a demo
          </h3>
          <div className="start-demo">
            <button className="btn big" disabled={busy} onClick={() => void startDemo("arx-217")}>
              Open demo: {DEMO_NAMES["arx-217"]}
            </button>
            {compact ? (
              <p className="muted small">Fictional liquid mAb in vials; shows every kind of difference.</p>
            ) : (
              <p className="muted small">
                A fictional liquid mAb in 2R vials moving between two sites. It shows every kind of difference the tool can find (all eight comparison categories), so it is a good way to
                see the gap assessment from start to finish. It also carries a short TRD, batch record, sampling plan and risk assessment.
              </p>
            )}
          </div>
          <div className="start-demo">
            <button className="btn big" disabled={busy} onClick={() => void startDemo("syr-305")}>
              Open demo: {DEMO_NAMES["syr-305"]}
            </button>
            {compact ? (
              <p className="muted small">Fictional prefilled syringe; the whole document chain is filled in.</p>
            ) : (
              <p className="muted small">
                A fictional prefilled syringe, filled at a receiving fill site from frozen drug substance. The whole document chain is filled in (a complete TRD, batch record, sampling
                plan and risk assessment), so it is a good way to see the follow-on documents.
              </p>
            )}
          </div>
        </div>
        {children}
      </div>
      {/* A status region that is always on the page, so a screen reader announces the text when it appears. */}
      <div role="status" data-testid="demo-status">
        {demoBuilding && <p className="notice">Building the demo: {demoBuilding}…</p>}
      </div>
      {!stay && homeFlash && (
        <p className="notice" data-testid="demo-opened">
          {homeFlash}
        </p>
      )}
      <p className="muted small">
        Both demos are fictional. {remote ? "Opening one adds it to your projects on the server." : "Opening one replaces the project open in this browser (you are asked first)."}
      </p>
      <Modal open={creating} onOpenChange={setCreating} title="New project" description="Name the project and the person answering.">
        <ResponderForm
          withTitle
          submitLabel="Create project"
          onSubmit={(v) => {
            newProject(v.title!, { name: v.name, ...(v.role ? { role: v.role } : {}) });
            setCreating(false);
            // The Scope step comes right after project setup, before the interview, so nobody answers questions about steps they do not have.
            navigate(after?.path ?? "/scope", after?.params);
          }}
        />
      </Modal>
    </>
  );
}
