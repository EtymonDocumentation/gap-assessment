import { useEffect, useState } from "react";
import { ScopePage } from "./pages/ScopePage";
import { ComparePage } from "./pages/ComparePage";
import { DocumentPage } from "./pages/DocumentPage";
import { GuidancePage } from "./pages/GuidancePage";
import { HomePage } from "./pages/HomePage";
import { InterviewPage } from "./pages/InterviewPage";
import { BuilderPage } from "./pages/BuilderPage";
import { ChangesPage } from "./pages/ChangesPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SourcesPage } from "./pages/SourcesPage";
import { TbdPage } from "./pages/TbdPage";
import { MyFilesPage } from "./pages/MyFilesPage";
import { RiskMethodsPage } from "./pages/RiskMethodsPage";
import { RiskPage } from "./pages/RiskPage";
import { SamplingPage } from "./pages/SamplingPage";
import { SamplingSubsectionsPage } from "./pages/SamplingSubsectionsPage";
import { SamplingTablesPage } from "./pages/SamplingTablesPage";
import { MbrLibraryPage } from "./pages/MbrLibraryPage";
import { SavedAnswersPage } from "./pages/SavedAnswersPage";
import { TrdLibraryPage } from "./pages/TrdLibraryPage";
import { MbrPage } from "./pages/MbrPage";
import { MbrProcessViewPage } from "./pages/MbrProcessView";
import { TrdPage } from "./pages/TrdPage";
import { TrdSeedPage } from "./pages/TrdSeedPage";
import { MappingPage } from "./pages/MappingPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { ValidationPage } from "./pages/ValidationPage";
import { PocBanner, PocFooter } from "./components";
import { MainNav, type NavGroup } from "./nav";
import { GAP_STEPS } from "./next-step";
import { DocChainBar, DocChainStrip, ModuleLibraryLinks } from "./DocChain";
import { chainStageOf } from "./chain";
import { GapStepBar, GapStepFooter, gapStepIndex } from "./steps";
import { useRoute } from "./router";
import { AccountBar, ConflictDialog, ServerGate, useIsRemote } from "./server/ServerUi";
import { SERVER_MODE } from "./server/mode";
import { useSession } from "./server/session-store";
import { useMbrAllowed, useRiskAllowed, useTrdAllowed } from "./risk-module";
import { useStore } from "./store";

/** Shown instead of the sampling pages on an account without the sampling module. */
function SamplingNotIncluded() {
  return (
    <section className="card stack" data-testid="sampling-not-included">
      <h1>Sampling plan</h1>
      <p>This account does not include the sampling module. Ask the administrator to add it.</p>
    </section>
  );
}

/** Shown instead of the TRD pages on an account without the TRD module. */
function TrdNotIncluded() {
  return (
    <section className="card stack" data-testid="trd-not-included">
      <h1>TRD</h1>
      <p>This account does not include the TRD module. Ask the administrator to add it.</p>
    </section>
  );
}

/** Shown instead of the batch record pages on an account without the batch record module. */
function MbrNotIncluded() {
  return (
    <section className="card stack" data-testid="mbr-not-included">
      <h1>Batch record</h1>
      <p>This account does not include the batch record module. Ask the administrator to add it.</p>
    </section>
  );
}

/** Shown instead of the risk pages on an account without the risk module. */
function RiskNotIncluded() {
  return (
    <section className="card stack" data-testid="risk-not-included">
      <h1>Risk assessment</h1>
      <p>This account does not include the risk module. Ask the administrator to add it.</p>
    </section>
  );
}

type Theme = "system" | "light" | "dark";

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem("gap-theme");
      return t === "light" || t === "dark" ? t : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "system") delete el.dataset.theme;
    else el.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem("gap-theme");
      else localStorage.setItem("gap-theme", theme);
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
  }, [theme]);
  return [theme, setTheme];
}

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
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    void init();
  }, [init]);

  // Move focus to the main heading on page change, for keyboard and screen reader users.
  // A page that has already put focus somewhere inside the main area (the interview card does) keeps it.
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main?.contains(document.activeElement) || document.activeElement === main) main?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [route.path]);

  // The template library belongs to the browser, not to a project, so it opens without one. So does the guidance library,
  // which is reference material and has nothing to do with the open project.
  const needsProject = route.path !== "/" && route.path !== "/templates" && route.path !== "/guidance" && route.path !== "/saved-answers" && route.path !== "/sampling/tables" && route.path !== "/sampling/subsections" && route.path !== "/risk/methods" && route.path !== "/mbr/library" && route.path !== "/trd/writeups" && route.path !== "/myfiles";
  const mappingId = /^\/templates\/([^/]+)\/mapping$/.exec(route.path)?.[1];
  // Documents run in chain order (gap assessment, TRD, sampling plan, batch record), each with a line saying what it is for. They are all
  // optional: the order is a suggestion about which document feeds the next, never a rule. Risk and the TBD list sit alongside the chain.
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
          covers: GAP_STEPS.map((s) => s.path),
          children: GAP_STEPS.map((s) => ({ path: s.path, label: s.label })),
        },
        ...(trdAllowed ? [{ path: "/trd", label: "TRD", num: 2, desc: "Technical requirements. Start from this project or blank." }] : []),
        ...(samplingAllowed ? [{ path: "/sampling", label: "Sampling plan", num: 3, desc: "Where and when to sample in the PPQ batches." }] : []),
        ...(mbrAllowed ? [{ path: "/mbr", label: "Batch record", num: 4, desc: "The manufacturing batch record. Also opens the Process view." }] : []),
      ],
      sub: {
        heading: "Alongside",
        items: [
          ...(riskAllowed ? [{ path: "/risk", label: "Risk assessment", desc: "Rate risks with a method you choose." }] : []),
          { path: "/tbd", label: "Open items (TBD)", desc: "Every value still to be decided, with owner and due date." },
        ],
      },
    },
    {
      label: "Library",
      items: [
        { path: "/templates", label: "Templates" },
        { path: "/guidance", label: "Guidance" },
        { path: "/saved-answers", label: "Saved answers" },
        { path: "/sources", label: "Sources" },
        { path: "/builder", label: "Builder" },
        { path: "/changes", label: "Change log" },
      ],
    },
  ];
  let page: React.ReactNode;
  if (!ready) page = <p className="muted">Loading…</p>;
  else if (needsProject && !project) page = <HomePage notice="Open the demo or start a new project first." />;
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
  else if (route.path === "/sampling") page = samplingAllowed ? <SamplingPage params={route.params} /> : <SamplingNotIncluded />;
  else if (route.path === "/risk/methods") page = riskAllowed ? <RiskMethodsPage /> : <RiskNotIncluded />;
  else if (route.path === "/risk") page = riskAllowed ? <RiskPage params={route.params} /> : <RiskNotIncluded />;
  else if (route.path === "/trd/writeups") page = trdAllowed ? <TrdLibraryPage /> : <TrdNotIncluded />;
  else if (route.path === "/trd") page = trdAllowed ? <TrdPage params={route.params} /> : <TrdNotIncluded />;
  else if (route.path === "/mbr/library") page = mbrAllowed ? <MbrLibraryPage /> : <MbrNotIncluded />;
  else if (route.path === "/mbr/view") page = mbrAllowed ? <MbrProcessViewPage params={route.params} /> : <MbrNotIncluded />;
  else if (route.path === "/mbr") page = mbrAllowed ? <MbrPage params={route.params} /> : <MbrNotIncluded />;
  else if (route.path === "/builder" || route.path === "/model") page = <BuilderPage />;
  else if (route.path === "/sources") page = <SourcesPage />;
  else if (route.path === "/tbd") page = <TbdPage />;
  else if (route.path === "/changes") page = <ChangesPage />;
  else if (route.path === "/templates") page = <TemplatesPage />;
  else if (route.path === "/guidance") page = <GuidancePage />;
  else if (route.path === "/saved-answers") page = <SavedAnswersPage />;
  else if (mappingId) page = <MappingPage id={decodeURIComponent(mappingId)} />;
  else page = <HomePage />;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <PocBanner sub={remote ? "Fictional data only. Your data is kept on the server." : "Fictional data only. Data stays in this browser."} />
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          {/* One line with an ellipsis, so a long project title never pushes the menu and the theme picker onto more rows; the full title is the tooltip. */}
          <span title={project ? `Gap Assessment Generator · ${project.meta.title}` : undefined}>
            Gap Assessment Generator
            {project && <span className="brand-project"> · {project.meta.title}</span>}
          </span>
        </div>
        <MainNav
          routePath={route.path}
          home={{ path: "/", label: "Home" }}
          // "Gap assessment" always opens the Scope step, so the link goes to the same place every time; with no project it goes Home, where the
          // project is started. What to do next is Home's job ("Next step"), not this link's.
          gap={{ path: project ? "/scope" : "/", label: "Gap assessment", covers: GAP_STEPS.map((s) => s.path) }}
          groups={groups}
          extra={SERVER_MODE ? [{ path: "/myfiles", label: "My files" }] : []}
        />
        <label className="theme-select">
          <span className="visually-hidden">Colour theme</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            <option value="system">Theme: system</option>
            <option value="light">Theme: light</option>
            <option value="dark">Theme: dark</option>
          </select>
        </label>
      </header>
      {SERVER_MODE && <AccountBar />}
      {error && (
        <div className="alert" role="alert">
          <span>{error}</span>
          <button className="btn small" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}
      <main id="main" tabIndex={-1}>
        {ready && project && chainStageOf(route.path) && <DocChainStrip route={route} />}
        {ready && project && gapStepIndex(route.path) >= 0 && <GapStepBar path={route.path} />}
        {ready && project && <ModuleLibraryLinks path={route.path} />}
        {page}
        {ready && project && gapStepIndex(route.path) >= 0 && <GapStepFooter path={route.path} />}
        {ready && project && chainStageOf(route.path) && <DocChainBar route={route} />}
      </main>
      <div className="visually-hidden" aria-live="polite">
        {status}
      </div>
      <PocFooter />
      {SERVER_MODE && remote && <ConflictDialog />}
    </>
  );
}
