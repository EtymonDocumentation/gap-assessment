import { TBD_DEFINITION } from "@gap/engine";
import { useState } from "react";
import { PageBanner } from "../art";
import { ProductEyebrow } from "../brand";
import { useChainAllowed } from "../DocChain";
import { documentDownloadedNote, nextStep, stepDone } from "../next-step";
import { href } from "../router";
import { useAssessment, useStore } from "../store";

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

/**
 * The gap assessment's own page: what it does and the Getting started checklist. It used to be Home, back when the whole site was the gap
 * assessment; now Home is Cascade's start page for every document and this page belongs to the first document of the chain. It can be read
 * without a project (the checklist then starts with "Create a project", a link to Home where that is done).
 */
export function GapPage() {
  const project = useStore((s) => s.project);
  const a = useAssessment();
  const allowed = useChainAllowed();
  const [hidden, setHidden] = useState(readHidden);
  const next = project && a ? nextStep(project, a) : null;
  const done = project && a ? stepDone(project, a) : {};
  const firstRecord = project?.mbr.records[0];

  const setHide = (h: boolean) => {
    setHidden(h);
    writeHidden(h);
  };

  // Each item ticks only where the project data proves it; the rest are plain links (no tick never means "not done").
  const checklist: { key: string; label: string; hint: string; path?: string; params?: Record<string, string>; ticked: boolean; note?: string | undefined }[] = [
    { key: "create", label: "Create a project", hint: "Press “Start a new project” on the Home page. Give it a name and say who is answering.", path: "/", ticked: !!project },
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
    <div className="stack-lg" data-testid="gap-page">
      <PageBanner art="page-home-hero" size="hero">
        <ProductEyebrow />
        <h1>Gap assessment for technology transfer</h1>
      </PageBanner>

      <section className="stack home-intro" aria-labelledby="gap-what-h" data-tour="gap-intro">
        <h2 id="gap-what-h">What the gap assessment does</h2>
        <p className="lede">
          You compare how a product is made at the <strong>sending unit</strong> (SU) with how the <strong>receiving unit</strong> (RU) site plans to make it. The tool asks guided
          questions, lists every difference (gap), and drafts the gap assessment document. The other documents (TRD, sampling plan, batch record) can follow from it, and every stage is optional.
        </p>
        <p className="muted">
          Anything not yet known is marked TBD and stays visible as an open item. {TBD_DEFINITION} The tool never fills in values for you.
        </p>
        <p>
          {next ? (
            <a className="btn primary big" href={href(next.path)} data-testid="gap-continue" data-tour="gap-next">
              {next.label}
            </a>
          ) : (
            <a className="btn primary big" href={href("/")} data-testid="gap-start" data-tour="gap-next">
              Start or open a project on Home
            </a>
          )}
        </p>
      </section>

      {hidden ? (
        <p>
          <button className="link-btn" onClick={() => setHide(false)}>
            Show getting started
          </button>
        </p>
      ) : (
        <section className="card stack" aria-labelledby="started-h" data-testid="getting-started" data-tour="gap-started">
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
                  {c.path && (project || c.key === "create") ? <a href={href(c.path, c.params)}>{c.label}</a> : <strong>{c.label}</strong>}
                  {c.ticked && <span className="visually-hidden"> (done)</span>}
                  {c.note && <span className="muted small"> ({c.note})</span>}
                  <p className="muted small">{c.hint}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
