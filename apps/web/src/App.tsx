import { STORAGE_PHRASE_BROWSER, STORAGE_PHRASE_SERVER } from "@gap/engine";
import { useEffect, useRef } from "react";
import { AboutPage } from "./pages/AboutPage";
import { ScopePage } from "./pages/ScopePage";
import { ComparePage } from "./pages/ComparePage";
import { DocumentPage } from "./pages/DocumentPage";
import { GlossaryPage } from "./pages/GlossaryPage";
import { GuidancePage } from "./pages/GuidancePage";
import { GapPage } from "./pages/GapPage";
import { HomePage } from "./pages/HomePage";
import { NeedsProject } from "./pages/NeedsProject";
import { InterviewPage } from "./pages/InterviewPage";
import { BuilderPage } from "./pages/BuilderPage";
import { ChangesPage } from "./pages/ChangesPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SourcesPage } from "./pages/SourcesPage";
import { TbdPage } from "./pages/TbdPage";
import { VersionsPage } from "./pages/VersionsPage";
import { StageReviewPage } from "./pages/StageReviewPage";
import { VersionComparePage } from "./pages/VersionComparePage";
import { MyFilesPage } from "./pages/MyFilesPage";
import { RiskMethodsPage } from "./pages/RiskMethodsPage";
import { RiskPage } from "./pages/RiskPage";
import { SamplingPage } from "./pages/SamplingPage";
import { ExpectedStudiesPage } from "./pages/ExpectedStudiesPage";
import { SamplingSubsectionsPage } from "./pages/SamplingSubsectionsPage";
import { SamplingTablesPage } from "./pages/SamplingTablesPage";
import { MbrLibraryPage } from "./pages/MbrLibraryPage";
import { SavedAnswersPage } from "./pages/SavedAnswersPage";
import { TrdLibraryPage } from "./pages/TrdLibraryPage";
import { MbrPage } from "./pages/MbrPage";
import { MbrProcessViewPage } from "./pages/MbrProcessView";
import { TrdImportPage } from "./pages/TrdImportPage";
import { GapImportPage } from "./pages/GapImportPage";
import { SamplingImportPage } from "./pages/SamplingImportPage";
import { TrdPage } from "./pages/TrdPage";
import { TrdSeedPage } from "./pages/TrdSeedPage";
import { MappingPage } from "./pages/MappingPage";
import { TrdMatchPage } from "./pages/TrdMatchPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { ValidationPage } from "./pages/ValidationPage";
import { NoticeFooter, NoticeStrip } from "./components";
import { AppHeader } from "./header";
import type { NavGroup } from "./nav";
import { GAP_STEPS } from "./next-step";
import { DocChainBar } from "./DocChain";
import { chainStageOf } from "./chain";
import { GapStepFooter, gapStepIndex } from "./steps";
import { href, useRoute } from "./router";
import { TourHost } from "./tour";
import { ConflictDialog, ServerGate, useIsRemote } from "./server/ServerUi";
import { SERVER_MODE } from "./server/mode";
import { useSession } from "./server/session-store";
import { useExcipientAllowed, useMbrAllowed, useRiskAllowed, useTrdAllowed } from "./risk-module";
import { ExcipientLibraryPage } from "./pages/ExcipientLibraryPage";
import { ExcipientPage } from "./pages/ExcipientPage";
import { useStore } from "./store";
import { VersionBanner } from "./version-ui";

/**
 * Shown instead of a module's pages on an account that does not include the module (server mode). It says so first, even when no project is
 * open: asking for a project to open a page that can never open was a detour to a dead end (EOU-41). It also says what still works and links
 * back to Home, so the page is not the end of the road (EOU-42). The first sentence is the same for every module.
 */
function ModuleNotIncluded({ testId, title, module }: { testId: string; title: string; module: string }) {
  return (
    <section className="card stack" data-testid={testId}>
      <h1>{title}</h1>
      <p>This account does not include the {module} module. Ask the administrator to add it.</p>
      <p className="muted">Everything else in your account works as before. Home shows the documents you can start.</p>
      <p>
        <a className="btn" href={href("/")}>
          Back to Home
        </a>
      </p>
    </section>
  );
}

const SamplingNotIncluded = () => <ModuleNotIncluded testId="sampling-not-included" title="Sampling plan" module="sampling" />;
/** A template's "Match your headings" page for the TRD. It works without an open project (it then lists the whole TRD write-up library). */
const TRD_MATCH_PATH = /^\/templates\/([^/]+)\/trd-match$/;
const TrdNotIncluded = () => <ModuleNotIncluded testId="trd-not-included" title="Technical requirements document (TRD)" module="TRD" />;
const MbrNotIncluded = () => <ModuleNotIncluded testId="mbr-not-included" title="Batch record" module="batch record" />;
const RiskNotIncluded = () => <ModuleNotIncluded testId="risk-not-included" title="Risk assessment" module="risk" />;
const ExcipientNotIncluded = () => <ModuleNotIncluded testId="excipient-not-included" title="Excipient assessment" module="excipient" />;

/** In server mode the app opens behind the sign-in page; the static build (GitHub Pages) has no sign-in and no network calls. */
export function App() {
  if (SERVER_MODE) {
    return (
      <ServerGate>
        <AppShell />
      </ServerGate>
    );
  }
  return <AppShell />;
}

function AppShell() {
  const route = useRoute();
  const remote = SERVER_MODE && useIsRemote();
  const { ready, project, error, status, init, clearError } = useStore();
  // The sampling module is always on in the static demo. On the server it needs the "sampling" module on the account; the menu
  // entry is hidden without it, and the server refuses the data calls too.
  const modules = useSession((s) => s.user?.plan.modules);
  const samplingAllowed = !SERVER_MODE || !!modules?.includes("sampling");
  const riskAllowed = useRiskAllowed();
  const trdAllowed = useTrdAllowed();
  const mbrAllowed = useMbrAllowed();
  const excipientAllowed = useExcipientAllowed();

  useEffect(() => {
    void init();
  }, [init]);

  // The hidden announcement area keeps its last message until something replaces it, so "Batch record created" was still there when a
  // tester reached My files. A message belongs to the page it was made on: it is cleared on the next page change, unless it was made in the
  // same moment as the change (an action that opens a new page announces its result there, and that has to be heard).
  const statusAt = useRef(0);
  useEffect(() => {
    statusAt.current = Date.now();
  }, [status]);

  // Move focus to the main heading on page change, for keyboard and screen reader users.
  // A page that has already put focus somewhere inside the main area (the interview card does) keeps it.
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main?.contains(document.activeElement) || document.activeElement === main) main?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    // "Demo opened: ..." belongs to the visit to Home that followed the click; it is gone once the user goes anywhere else.
    if (route.path !== "/") useStore.setState({ homeFlash: "", listNote: null });
    if (Date.now() - statusAt.current > 1500) useStore.setState({ status: "" });
  }, [route.path]);

  // The template library belongs to the browser, not to a project, so it opens without one. So does the guidance library,
  // which is reference material and has nothing to do with the open project.
  const needsProject = route.path !== "/" && route.path !== "/gap" && route.path !== "/gap/import" && route.path !== "/templates" && route.path !== "/guidance" && route.path !== "/saved-answers" && route.path !== "/sampling/tables" && route.path !== "/sampling/subsections" && route.path !== "/sampling/expected" && route.path !== "/risk/methods" && route.path !== "/mbr/library" && route.path !== "/excipient/library" && route.path !== "/trd/writeups" && route.path !== "/myfiles" && route.path !== "/about" && route.path !== "/glossary" && !TRD_MATCH_PATH.test(route.path);
  const mappingId = /^\/templates\/([^/]+)\/mapping$/.exec(route.path)?.[1];
  const trdMatchId = TRD_MATCH_PATH.exec(route.path)?.[1];
  // Documents run in chain order (gap assessment, TRD, sampling plan, batch record), each with a line saying what it is for. They are all
  // optional: the order is a suggestion about which document feeds the next, never a rule. Risk and the TBD list sit alongside the chain.
  // Version history and the Change log are not here either (EOU-36): they belong to the open project, not to the library, so they are reached from the
  // version chip in the header and from the project's panel on Home. Their addresses (#/versions, #/changes) still open.
  // The module libraries are not here: they have a "Library" button on their own module's pages (see ModuleLibraryLinks).
  const groups: NavGroup[] = [
    {
      label: "Documents",
      items: [
        {
          path: "/scope",
          label: "Gap assessment",
          num: 1,
          plain: true,
          desc: "Compare the sending and receiving unit and list the gaps.",
          // The gap assessment's own page (what it does, and the Getting started checklist) comes first in its list, before the six steps.
          covers: ["/gap", "/gap/import", ...GAP_STEPS.map((s) => s.path)],
          children: [{ path: "/gap", label: "Getting started" }, ...GAP_STEPS.map((s) => ({ path: s.path, label: s.label }))],
        },
        ...(trdAllowed ? [{ path: "/trd", label: "TRD", num: 2, desc: "Technical requirements. Start from this project or blank." }] : []),
        ...(samplingAllowed ? [{ path: "/sampling", label: "Sampling plan", num: 3, desc: "Where and when to sample in the PPQ (process performance qualification) batches." }] : []),
        ...(mbrAllowed ? [{ path: "/mbr", label: "Batch record", num: 4, desc: "The step-by-step instruction for making one batch. Also opens the Process view." }] : []),
      ],
      sub: {
        heading: "Alongside",
        items: [
          ...(riskAllowed ? [{ path: "/risk", label: "Risk assessment", desc: "Rate risks with a method you choose." }] : []),
          ...(excipientAllowed ? [{ path: "/excipient", label: "Excipient assessment", desc: "Compare the excipients between the sending and the receiving site." }] : []),
          { path: "/tbd", label: "Open items", desc: "Every value still to be decided, with owner and due date." },
        ],
      },
    },
    {
      label: "Library",
      items: [
        { path: "/templates", label: "Templates", desc: "Your own Word or PDF templates, to choose when you create a Word document." },
        { path: "/guidance", label: "Guidance", desc: "Official regulations and guidance, to read the source text behind a gap." },
        { path: "/saved-answers", label: "Saved answers", desc: "Your own sets of interview answers, to offer to another project." },
        { path: "/sources", label: "Sources", desc: "Where each answer came from." },
        { path: "/builder", label: "Builder", desc: "Advanced view; the Interview is easier." },
      ],
    },
  ];
  const moduleOf = /^\/(sampling|trd|risk|mbr|excipient)(\/|$)/.exec(route.path)?.[1];
  const notIncluded: React.ReactNode =
    moduleOf === "excipient" && !excipientAllowed ? <ExcipientNotIncluded /> : moduleOf === "sampling" && !samplingAllowed ? <SamplingNotIncluded /> : moduleOf === "trd" && !trdAllowed ? <TrdNotIncluded /> : moduleOf === "risk" && !riskAllowed ? <RiskNotIncluded /> : moduleOf === "mbr" && !mbrAllowed ? <MbrNotIncluded /> : null;
  let page: React.ReactNode;
  if (!ready) page = <p className="muted">Loading…</p>;
  // A project page with no project open used to show Home with a one-line notice, which looked as if the menu click had done nothing. The box
  // names the page that was asked for and offers the ways to open a project right there.
  // A module this account does not include is said first, with or without a project (the box below would only offer to open one for a page that cannot open).
  else if (notIncluded) page = notIncluded;
  else if (needsProject && !project) page = <NeedsProject path={route.path} />;
  else if (route.path === "/gap") page = <GapPage />;
  else if (route.path === "/gap/import") page = <GapImportPage />;
  else if (route.path === "/about") page = <AboutPage />;
  else if (route.path === "/glossary") page = <GlossaryPage params={route.params} />;
  else if (SERVER_MODE && route.path === "/myfiles") page = <MyFilesPage params={route.params} />;
  else if (route.path === "/scope") page = <ScopePage />;
  else if (route.path === "/interview") page = <InterviewPage params={route.params} />;
  else if (route.path === "/compare") page = <ComparePage />;
  else if (route.path === "/register") page = <RegisterPage />;
  else if (route.path === "/validation") page = <ValidationPage />;
  else if (route.path === "/document") page = <DocumentPage />;
  else if (route.path === "/trd-seed") page = <TrdSeedPage />;
  else if (route.path === "/sampling/tables") page = samplingAllowed ? <SamplingTablesPage /> : <SamplingNotIncluded />;
  else if (route.path === "/sampling/subsections") page = samplingAllowed ? <SamplingSubsectionsPage /> : <SamplingNotIncluded />;
  else if (route.path === "/sampling/expected") page = samplingAllowed ? <ExpectedStudiesPage /> : <SamplingNotIncluded />;
  else if (route.path === "/sampling/import") page = samplingAllowed ? <SamplingImportPage /> : <SamplingNotIncluded />;
  else if (route.path === "/sampling") page = samplingAllowed ? <SamplingPage params={route.params} /> : <SamplingNotIncluded />;
  else if (route.path === "/risk/methods") page = riskAllowed ? <RiskMethodsPage /> : <RiskNotIncluded />;
  else if (route.path === "/risk") page = riskAllowed ? <RiskPage params={route.params} /> : <RiskNotIncluded />;
  else if (route.path === "/excipient/library") page = excipientAllowed ? <ExcipientLibraryPage /> : <ExcipientNotIncluded />;
  else if (route.path === "/excipient") page = excipientAllowed ? <ExcipientPage params={route.params} /> : <ExcipientNotIncluded />;
  else if (route.path === "/trd/writeups") page = trdAllowed ? <TrdLibraryPage /> : <TrdNotIncluded />;
  else if (route.path === "/trd/import") page = trdAllowed ? <TrdImportPage /> : <TrdNotIncluded />;
  else if (route.path === "/trd") page = trdAllowed ? <TrdPage params={route.params} /> : <TrdNotIncluded />;
  else if (route.path === "/mbr/library") page = mbrAllowed ? <MbrLibraryPage /> : <MbrNotIncluded />;
  else if (route.path === "/mbr/view") page = mbrAllowed ? <MbrProcessViewPage params={route.params} /> : <MbrNotIncluded />;
  else if (route.path === "/mbr") page = mbrAllowed ? <MbrPage params={route.params} /> : <MbrNotIncluded />;
  else if (route.path === "/builder" || route.path === "/model") page = <BuilderPage />;
  else if (route.path === "/sources") page = <SourcesPage />;
  else if (route.path === "/tbd") page = <TbdPage />;
  else if (route.path === "/changes") page = <ChangesPage />;
  else if (route.path === "/versions/compare") page = <VersionComparePage params={route.params} />;
  else if (route.path === "/versions") page = <VersionsPage />;
  else if (route.path === "/stage-review") page = <StageReviewPage />;
  else if (route.path === "/templates") page = <TemplatesPage />;
  else if (route.path === "/guidance") page = <GuidancePage />;
  else if (route.path === "/saved-answers") page = <SavedAnswersPage />;
  else if (mappingId) page = <MappingPage id={decodeURIComponent(mappingId)} />;
  else if (trdMatchId) page = trdAllowed ? <TrdMatchPage id={decodeURIComponent(trdMatchId)} params={route.params} /> : <TrdNotIncluded />;
  else page = <HomePage />;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <NoticeStrip storage={remote ? STORAGE_PHRASE_SERVER : STORAGE_PHRASE_BROWSER} />
      <AppHeader routePath={route.path} groups={groups} />
      {ready && project && <VersionBanner />}
      {error && (
        <div className="alert" role="alert">
          <span>{error}</span>
          <button className="btn small" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}
      <main id="main" tabIndex={-1}>
        {/* The chain strip, the gap steps and the module library buttons are part of each page's header (PageHeader), under its title. */}
        {page}
        {ready && project && gapStepIndex(route.path) >= 0 && <GapStepFooter path={route.path} />}
        {ready && project && chainStageOf(route.path) && <DocChainBar route={route} />}
      </main>
      <div className="visually-hidden" aria-live="polite">
        {status}
      </div>
      <NoticeFooter />
      <TourHost routePath={route.path} />
      {SERVER_MODE && remote && <ConflictDialog />}
    </>
  );
}
