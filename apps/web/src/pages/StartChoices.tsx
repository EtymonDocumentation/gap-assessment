import type { ReactNode } from "react";
import { useState } from "react";
import { DEMO_NAMES, type DemoId } from "../demo-build";
import { Modal, ResponderForm } from "../components";
import { navigate } from "../router";
import { useIsRemote } from "../server/ServerUi";
import { SERVER_MODE } from "../server/mode";
import { loadList, useSync } from "../server/sync";
import { useStore } from "../store";

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
  const remote = SERVER_MODE && useIsRemote();
  const busy = demoBuilding !== null;
  // Server storage: every project is its own saved project on the server, so nothing is replaced.
  const confirmReplace = () => remote || !project || window.confirm("This replaces the project currently open in this browser. Export it first if you want to keep it. Continue?");

  // Opens a demo and, if the person is still where they clicked, lands on Home (the overview of the project). The demo builds away from the page, so
  // the person may have gone elsewhere meanwhile; they are then left where they are and the screen reader line still says the demo is open.
  const startDemo = async (id: DemoId) => {
    if (demoBuilding || !confirmReplace()) return;
    const where = window.location.hash;
    // The names already in My projects decide whether a demo opened again needs a number (the list is only read in server mode).
    if (remote && useSync.getState().listState !== "ready") await loadList();
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
          <button className="btn primary big" disabled={busy} onClick={() => confirmReplace() && setCreating(true)}>
            Start a new project
          </button>
          <p className="muted small">Name it and say who is answering. Then you choose the scope and answer the guided questions.</p>
        </div>
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
            navigate("/scope");
          }}
        />
      </Modal>
    </>
  );
}
