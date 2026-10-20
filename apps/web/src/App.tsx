import { useEffect, useState } from "react";
import { ComparePage } from "./pages/ComparePage";
import { DocumentPage } from "./pages/DocumentPage";
import { HomePage } from "./pages/HomePage";
import { InterviewPage } from "./pages/InterviewPage";
import { BuilderPage } from "./pages/BuilderPage";
import { RegisterPage } from "./pages/RegisterPage";
import { href, useRoute } from "./router";
import { useStore } from "./store";

const NAV = [
  { path: "/", label: "Project" },
  { path: "/interview", label: "Interview" },
  { path: "/compare", label: "Side by side" },
  { path: "/register", label: "Gap register" },
  { path: "/document", label: "Document" },
  { path: "/builder", label: "Builder" },
] as const;

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

export function App() {
  const route = useRoute();
  const { ready, project, error, status, init, clearError } = useStore();
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    void init();
  }, [init]);

  // Move focus to the main heading on page change, for keyboard and screen reader users.
  useEffect(() => {
    document.getElementById("main")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [route.path]);

  const needsProject = route.path !== "/";
  let page: React.ReactNode;
  if (!ready) page = <p className="muted">Loading…</p>;
  else if (needsProject && !project) page = <HomePage notice="Open the demo or start a new project first." />;
  else if (route.path === "/interview") page = <InterviewPage params={route.params} />;
  else if (route.path === "/compare") page = <ComparePage />;
  else if (route.path === "/register") page = <RegisterPage />;
  else if (route.path === "/document") page = <DocumentPage />;
  else if (route.path === "/builder" || route.path === "/model") page = <BuilderPage />;
  else page = <HomePage />;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="poc-banner" role="note">
        <strong>Proof of concept. Not validated. Not for GMP use.</strong>
        <span className="poc-sub"> Fictional data only. Data stays in this browser.</span>
      </div>
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
            {NAV.map((n) => (
              <li key={n.path}>
                <a href={href(n.path)} aria-current={route.path === n.path || (n.path === "/builder" && route.path === "/model") ? "page" : undefined}>
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
      <footer className="app-footer">
        Proof of concept. Not validated. Not for GMP use. The tool never determines regulatory filing categories.
      </footer>
    </>
  );
}
