import { PRODUCT_NAME, STORAGE_PHRASE_BROWSER, STORAGE_PHRASE_SERVER } from "@gap/engine";
import { useEffect, useId, useState } from "react";
import { CascadeMark } from "./brand";
import { useDisclosure } from "./disclosure";
import { MainNav, type NavGroup } from "./nav";
import { GAP_STEPS } from "./next-step";
import { href } from "./router";
import { AccountMenu, ChangePasswordDialog, PhoneAccount, SaveProblem, SaveStatus, useIsRemote } from "./server/ServerUi";
import { SERVER_MODE } from "./server/mode";
import { useStore } from "./store";
import { PHONE_WIDTH, useNarrow } from "./viewport";

// ------------------------------------------------------------------ colour theme

export type Theme = "system" | "light" | "dark";

/** The colour theme, kept in this browser. "System" follows the device setting and stores nothing. */
export function useTheme(): [Theme, (t: Theme) => void] {
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

const THEME_CHOICES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Monitor (system), sun (light) or moon (dark). Decorative: the words are always beside it or in the button's name. */
function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {theme === "light" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      ) : theme === "dark" ? (
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      ) : (
        <>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </>
      )}
    </svg>
  );
}

/**
 * The theme button at the right of the header: an icon showing the current choice, opening System / Light / Dark. The choice applies at
 * once and the panel stays open (arrow keys move between the three), so the person sees what each does; Escape or a click elsewhere
 * closes it.
 */
function ThemeMenu() {
  const [theme, setTheme] = useTheme();
  const d = useDisclosure();
  const name = useId();
  const current = THEME_CHOICES.find((c) => c.value === theme)!;
  return (
    <div className="header-menu" ref={d.wrap} onKeyDown={d.onKeyDown} onBlur={d.onBlur}>
      <button ref={d.button} type="button" className="icon-btn" aria-expanded={d.open} aria-controls={d.id} aria-label={`Colour theme: ${current.label}`} onClick={() => d.setOpen((o) => !o)}>
        <ThemeIcon theme={theme} />
      </button>
      <div id={d.id} className="header-popover" hidden={!d.open}>
        {d.open && (
          <fieldset className="theme-options">
            <legend>Colour theme</legend>
            {THEME_CHOICES.map((c) => (
              <label key={c.value} className="theme-option">
                <input type="radio" name={name} value={c.value} checked={theme === c.value} onChange={() => setTheme(c.value)} />
                <ThemeIcon theme={c.value} />
                <span>{c.label}</span>
              </label>
            ))}
            <p className="small muted">System follows the setting of your device.</p>
          </fieldset>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ project button

/**
 * The open project at the right of the header bar. One line with an ellipsis, so a long title never pushes the menu onto more rows; the
 * full title is in the button's name and its tooltip. It opens Home, which is where a project is switched, started or closed.
 */
function ProjectLink({ title }: { title: string }) {
  return (
    <a className="header-project" href={href("/")} aria-label={`Project: ${title}. Open the project page`} title={title}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
      <span className="header-project-title" aria-hidden="true">
        {title}
      </span>
    </a>
  );
}

// ------------------------------------------------------------------ header

/**
 * The dark bar at the top of every page: the Cascade mark and name, the menus, then (right) the open project, the theme and, on the
 * server, the account. On a phone it is the mark, the name, the theme button and a 44 px Menu button; the open project, the account and
 * where the data is kept move into the Menu panel, and a failed save gets its own line under the bar.
 */
export function AppHeader({ routePath, groups }: { routePath: string; groups: NavGroup[] }) {
  const narrow = useNarrow(PHONE_WIDTH);
  const title = useStore((s) => s.project?.meta.title);
  const remote = SERVER_MODE && useIsRemote();
  const [passwordOpen, setPasswordOpen] = useState(false);

  const main = (
    <MainNav
      routePath={routePath}
      home={{ path: "/", label: "Home" }}
      // "Gap assessment" always opens the Scope step, so the link goes to the same place every time; with no project it goes Home, where the
      // project is started. What to do next is Home's job ("Next step"), not this link's.
      gap={{ path: title !== undefined ? "/scope" : "/", label: "Gap assessment", covers: GAP_STEPS.map((s) => s.path) }}
      groups={groups}
      extra={SERVER_MODE ? [{ path: "/myfiles", label: "My files" }] : []}
      phoneExtra={(close) => (
        <>
          {title !== undefined && <PhoneProject title={title} onPick={close} />}
          {SERVER_MODE && (
            <PhoneAccount
              onChangePassword={() => {
                close();
                setPasswordOpen(true);
              }}
            />
          )}
          <p className="small muted nav-storage">{remote ? STORAGE_PHRASE_SERVER : STORAGE_PHRASE_BROWSER}</p>
        </>
      )}
    />
  );

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <CascadeMark />
          <span className="brand-name">{PRODUCT_NAME}</span>
        </div>
        {narrow ? (
          <div className="header-tools">
            <ThemeMenu />
            {main}
          </div>
        ) : (
          <>
            {main}
            <div className="header-tools">
              {remote && <SaveStatus />}
              {title !== undefined && <ProjectLink title={title} />}
              <ThemeMenu />
              {SERVER_MODE && <AccountMenu onChangePassword={() => setPasswordOpen(true)} />}
            </div>
          </>
        )}
      </header>
      {narrow && remote && <SaveProblem />}
      {SERVER_MODE && passwordOpen && (
        <ChangePasswordDialog onClose={() => setPasswordOpen(false)} restoreFocus={() => document.querySelector<HTMLElement>(".account-btn, .nav-menu-btn")} />
      )}
    </>
  );
}

/** The open project inside the phone Menu panel: the full title (it may wrap) and a line saying where the link goes. */
function PhoneProject({ title, onPick }: { title: string; onPick: () => void }) {
  const descId = useId();
  return (
    <section>
      <p className="nav-panel-head">Project</p>
      <ul className="nav-panel-list">
        <li className="nav-entry">
          <a href={href("/")} className="nav-project" aria-describedby={descId} onClick={onPick}>
            {title}
          </a>
          <span id={descId} className="nav-desc">
            Open the project page, to switch, start or close a project.
          </span>
        </li>
      </ul>
    </section>
  );
}
