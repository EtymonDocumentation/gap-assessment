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
import { SamplingPage } from "./pages/SamplingPage";
import { SamplingTablesPage } from "./pages/SamplingTablesPage";
import { TrdSeedPage } from "./pages/TrdSeedPage";
import { MappingPage } from "./pages/MappingPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { ValidationPage } from "./pages/ValidationPage";
import { PocBanner, PocFooter } from "./components";
import { href, useRoute } from "./router";
import { AccountBar, ConflictDialog, ServerGate, useIsRemote } from "./server/ServerUi";
import { SERVER_MODE } from "./server/mode";
import { useSession } from "./server/session-store";
import { useStore } from "./store";

const NAV = [
  { path: "/", label: "Project" },
  { path: "/scope", label: "Scope" },
  { path: "/interview", label: "Interview" },
  { path: "/compare", label: "Side by side" },
  { path: "/register", label: "Gap register" },
  { path: "/validation", label: "Validation" },
  { path: "/document", label: "Document" },
  { path: "/trd-seed", label: "TRD seed" },
  { path: "/sampling", label: "Sampling plan" },
  { path: "/templates", label: "Templates" },
  { path: "/guidance", label: "Guidance" },
  { path: "/builder", label: "Builder" },
  { path: "/sources", label: "Sources" },
  { path: "/changes", label: "Change log" },
] as const;

/** Shown instead of the sampling pages on an account without the sampling module. */
function SamplingNotIncluded() {
  return (
    <section className="card stack" data-testid="sampling-not-included">
      <h1>Sampling plan</h1>
      <p>This account does not include the sampling module. Ask the administrator to add it.</p>
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
  const needsProject = route.path !== "/" && route.path !== "/templates" && route.path !== "/guidance" && route.path !== "/sampling/tables";
  const mappingId = /^\/templates\/([^/]+)\/mapping$/.exec(route.path)?.[1];
  let page: React.ReactNode;
  if (!ready) page = <p className="muted">Loading…</p>;
  else if (needsProject && !project) page = <HomePage notice="Open the demo or start a new project first." />;
  else if (route.path === "/scope") page = <ScopePage />;
  else if (route.path === "/interview") page = <InterviewPage params={route.params} />;
  else if (route.path === "/compare") page = <ComparePage />;
  else if (route.path === "/register") page = <RegisterPage />;
  else if (route.path === "/validation") page = <ValidationPage />;
  else if (route.path === "/document") page = <DocumentPage />;
  else if (route.path === "/trd-seed") page = <TrdSeedPage />;
  else if (route.path === "/sampling/tables") page = samplingAllowed ? <SamplingTablesPage /> : <SamplingNotIncluded />;
  else if (route.path === "/sampling") page = samplingAllowed ? <SamplingPage params={route.params} /> : <SamplingNotIncluded />;
  else if (route.path === "/builder" || route.path === "/model") page = <BuilderPage />;
  else if (route.path === "/sources") page = <SourcesPage />;
  else if (route.path === "/tbd") page = <TbdPage />;
  else if (route.path === "/changes") page = <ChangesPage />;
  else if (route.path === "/templates") page = <TemplatesPage />;
  else if (route.path === "/guidance") page = <GuidancePage />;
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
          <span>
            Gap Assessment Generator
            {project && <span className="brand-project"> · {project.meta.title}</span>}
          </span>
        </div>
        <nav aria-label="Main">
          <ul className="nav">
            {NAV.filter((n) => n.path !== "/sampling" || samplingAllowed).map((n) => (
              <li key={n.path}>
                <a href={href(n.path)} aria-current={route.path === n.path || (n.path === "/builder" && route.path === "/model") || (n.path === "/templates" && !!mappingId) || (n.path === "/sampling" && route.path === "/sampling/tables") ? "page" : undefined}>
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
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
        {page}
      </main>
      <div className="visually-hidden" aria-live="polite">
        {status}
      </div>
      <PocFooter />
      {SERVER_MODE && remote && <ConflictDialog />}
    </>
  );
}
